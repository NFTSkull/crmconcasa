-- ConCasa: fecha de inscripción posterior a los biométricos futuros.
-- Sin modificar expedientes, agenda histórica o cupos. Idempotente.

CREATE OR REPLACE FUNCTION public.reagendar_inscripcion_extraordinaria(p_expediente_id uuid, p_booking_date date, p_location_id text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp RECORD;
  v_old RECORD;
  v_req RECORD;
  v_loc TEXT;
  v_note TEXT;
  v_booking_id UUID;
  v_kind public.booking_kind := 'inscripcion';
  v_time TIME := TIME '11:00';
  v_avail INT;
  v_etapa INT;
  v_cancel JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: no autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;

  v_loc := public.agenda_inscripcion_normalize_location(p_location_id);
  IF NOT (v_loc IS NOT DISTINCT FROM 'monterrey'
    OR (v_loc IS NOT DISTINCT FROM 'apodaca' AND public.agenda_inscripcion_permite_apodaca(p_expediente_id))) THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: sede no autorizada para este expediente' USING ERRCODE = '22023';
  END IF;
  IF p_booking_date IS NULL OR p_booking_date < (timezone('America/Monterrey', now()))::date THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: fecha inválida' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id FOR UPDATE;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: expediente no disponible' USING ERRCODE = 'P0002';
  END IF;
  v_etapa := v_exp.etapa_actual;

  IF v_role = 'asesor' THEN
    IF v_exp.asesor_id IS DISTINCT FROM v_actor OR v_exp.organization_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: no autorizado' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    IF NOT public.can_see_expediente(p_expediente_id) THEN
      RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: no visible' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.subestado = 'rechazado'
     OR NOT public.agenda_inscripcion_etapa_permitida(v_exp.etapa_actual) THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: expediente no elegible' USING ERRCODE = '22023';
  END IF;

  SELECT b.* INTO v_old FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = v_kind
    AND b.status = 'booked'
  FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: sin cita activa' USING ERRCODE = '22023';
  END IF;

  v_cancel := public.cancel_inscripcion_extraordinaria(
    v_old.id, COALESCE(v_note, 'Reagenda inscripción'), false
  );

  SELECT r.* INTO v_req FROM public.agenda_inscripcion_requerimientos r
  WHERE r.expediente_id = p_expediente_id
    AND r.status IN ('pending_booking','rebook_required')
  FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: sin requirement abierto' USING ERRCODE = '22023';
  END IF;

  -- No programar inscripción antes de una cita biométrica futura en etapa 4.
  -- El asesor puede reservar con anticipación, siempre para una fecha posterior.
  IF public.agenda_inscripcion_earliest_post_bio_date(p_expediente_id) IS NOT NULL
     AND p_booking_date < public.agenda_inscripcion_earliest_post_bio_date(p_expediente_id) THEN
    RAISE EXCEPTION 'INSCRIPCION_ANTES_DE_BIOMETRICOS: selecciona una fecha posterior a los biométricos agendados'
      USING ERRCODE='22023';
  END IF;

  SELECT count(*)::INT INTO v_avail
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = v_exp.organization_id
    AND i.booking_date = p_booking_date
    AND i.kind = 'inscripcion'
    AND i.location_id = v_loc
    AND i.status = 'available'
    AND (i.sheet_slot_time = v_time OR (i.sheet_slot_time IS NULL AND i.slot_time = v_time));
  IF COALESCE(v_avail, 0) < 1 THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    v_exp.organization_id, v_kind, p_expediente_id, p_booking_date, v_time,
    v_loc, 'booked', v_note, v_actor
  ) RETURNING id INTO v_booking_id;

  UPDATE public.agenda_inscripcion_requerimientos
  SET status = 'booked', booked_booking_id = v_booking_id, updated_at = NOW()
  WHERE id = v_req.id;

  PERFORM public.log_action(
    v_exp.organization_id, v_actor, v_role,
    'agenda.inscripcion.reagendar', 'agenda_booking', v_booking_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'booking_anterior_id', v_old.id,
      'booking_date', p_booking_date,
      'booking_time', '11:00',
      'location_id', v_loc,
      'etapa_actual', v_etapa,
      'fecha_cita_unchanged', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'cancel', v_cancel,
    'booking_id', v_booking_id,
    'booking_anterior_id', v_old.id,
    'booking_date', p_booking_date,
    'booking_time', '11:00',
    'location_id', v_loc,
    'etapa_actual', v_etapa,
    'fecha_cita_unchanged', true
  );
END;
$function$
;
