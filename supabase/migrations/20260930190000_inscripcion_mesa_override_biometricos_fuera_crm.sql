-- Permite agendar Inscripción cuando existe un requerimiento explícito de Mesa
-- aunque los biométricos previos hayan ocurrido fuera del CRM/Drive.
-- No crea evidencia biométrica ficticia y conserva todos los demás gates.

CREATE OR REPLACE FUNCTION public.book_inscripcion_extraordinaria(
  p_expediente_id UUID,
  p_booking_date DATE,
  p_location_id TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp RECORD;
  v_req RECORD;
  v_loc TEXT;
  v_note TEXT;
  v_booking_id UUID;
  v_kind public.booking_kind := 'inscripcion';
  v_time TIME := TIME '11:00';
  v_avail INT;
  v_etapa INT;
  v_bio UUID;
  v_req_id UUID;
  v_req_created BOOLEAN := false;
  v_mesa_override BOOLEAN := false;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: no autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: solo asesor' USING ERRCODE = '42501';
  END IF;

  v_loc := public.agenda_inscripcion_normalize_location(p_location_id);
  IF v_loc IS DISTINCT FROM 'monterrey' THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: solo Monterrey' USING ERRCODE = '22023';
  END IF;
  IF p_booking_date IS NULL OR p_booking_date < (timezone('America/Monterrey', now()))::date THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: fecha inválida' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id FOR UPDATE;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: expediente no disponible' USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org OR v_exp.asesor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.subestado = 'rechazado'
     OR NOT public.agenda_inscripcion_etapa_permitida(v_exp.etapa_actual) THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: expediente no elegible' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_inscripcion_requerimientos r
    WHERE r.expediente_id = p_expediente_id
      AND r.source_type = 'mesa'
      AND r.status IN ('pending_booking', 'rebook_required')
  ) INTO v_mesa_override;

  IF NOT public.agenda_inscripcion_tiene_biometricos_previos(p_expediente_id)
     AND NOT v_mesa_override THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: sin biométricos previos' USING ERRCODE = '22023';
  END IF;
  v_etapa := v_exp.etapa_actual;

  IF EXISTS (
    SELECT 1 FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id AND b.kind = v_kind AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: ya existe cita activa' USING ERRCODE = '22023';
  END IF;

  SELECT r.* INTO v_req
  FROM public.agenda_inscripcion_requerimientos r
  WHERE r.expediente_id = p_expediente_id
    AND r.status IN ('pending_booking', 'rebook_required')
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT b.id INTO v_bio
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'biometricos'::public.booking_kind
    ORDER BY b.created_at DESC NULLS LAST
    LIMIT 1;

    BEGIN
      INSERT INTO public.agenda_inscripcion_requerimientos (
        organization_id, expediente_id, source_booking_id, source_kind, source_type,
        status, requested_by, reason
      ) VALUES (
        v_exp.organization_id,
        p_expediente_id,
        v_bio,
        CASE WHEN v_bio IS NULL THEN NULL ELSE 'biometricos'::public.booking_kind END,
        'asesor',
        'pending_booking',
        v_actor,
        'Inscripción requerida por asesor'
      )
      RETURNING id INTO v_req_id;
      v_req_created := true;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT r.* INTO v_req
        FROM public.agenda_inscripcion_requerimientos r
        WHERE r.expediente_id = p_expediente_id
          AND r.status IN ('pending_booking', 'rebook_required', 'booked')
        FOR UPDATE
        LIMIT 1;
        IF NOT FOUND OR v_req.status = 'booked' THEN
          RAISE EXCEPTION 'book_inscripcion_extraordinaria: ya existe cita activa'
            USING ERRCODE = '22023';
        END IF;
        v_req_id := v_req.id;
        v_req_created := false;
    END;

    IF v_req_created THEN
      SELECT r.* INTO v_req
      FROM public.agenda_inscripcion_requerimientos r
      WHERE r.id = v_req_id
      FOR UPDATE;

      PERFORM public.log_action(
        v_org, v_actor, v_role,
        'agenda.inscripcion.require', 'expediente', p_expediente_id,
        jsonb_build_object(
          'requirement_id', v_req_id,
          'source_type', 'asesor',
          'auto_created_during_book', true,
          'etapa_actual', v_etapa
        )
      );
    END IF;
  ELSE
    v_req_id := v_req.id;
    v_req_created := false;
  END IF;

  SELECT count(*)::INT INTO v_avail
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = v_org
    AND i.booking_date = p_booking_date
    AND i.kind = 'inscripcion'
    AND i.location_id = 'monterrey'
    AND i.status = 'available'
    AND (i.sheet_slot_time = v_time OR (i.sheet_slot_time IS NULL AND i.slot_time = v_time));
  IF COALESCE(v_avail, 0) < 1 THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    v_org, v_kind, p_expediente_id, p_booking_date, v_time,
    'monterrey', 'booked', v_note, v_actor
  ) RETURNING id INTO v_booking_id;

  UPDATE public.agenda_inscripcion_requerimientos
  SET status = 'booked', booked_booking_id = v_booking_id, updated_at = NOW()
  WHERE id = v_req.id;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'agenda.inscripcion.book', 'agenda_booking', v_booking_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'requirement_id', v_req.id,
      'requirement_created', v_req_created,
      'booking_date', p_booking_date,
      'booking_time', '11:00',
      'location_id', 'monterrey',
      'etapa_actual', v_etapa,
      'fecha_cita_unchanged', true,
      'mesa_override_sin_bio_crm', v_mesa_override
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'kind', 'inscripcion',
    'booking_date', p_booking_date,
    'booking_time', '11:00',
    'location_id', 'monterrey',
    'requirement_id', v_req.id,
    'requirement_created', v_req_created,
    'etapa_actual', v_etapa,
    'fecha_cita_unchanged', true,
    'mesa_override_sin_bio_crm', v_mesa_override
  );
END;
$$;

COMMENT ON FUNCTION public.book_inscripcion_extraordinaria(UUID, DATE, TEXT, TEXT) IS
  'Inscripción asesor: biométricos previos canónicos o requerimiento explícito de Mesa para casos históricos/fuera de CRM.';
