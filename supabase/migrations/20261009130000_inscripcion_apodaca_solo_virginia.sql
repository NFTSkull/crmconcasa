-- Excepcion individual: Virginia Alejandra Galvan Nava (Conchis Macias).
-- No se crean cupos ni citas ficticias. El booking sigue sujeto al inventario real de Drive.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('inscripcion_apodaca_expedientes', '["9433962b-ae9b-4609-a897-091437c19c93"]'::jsonb, NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Excepcion expresa de sede, solo para expedientes enumerados en app_settings.
CREATE OR REPLACE FUNCTION public.agenda_inscripcion_permite_apodaca(p_expediente_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_expediente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.app_settings s
    WHERE s.key = 'inscripcion_apodaca_expedientes'
      AND jsonb_typeof(s.value) = 'array'
      AND s.value ? p_expediente_id::text
  );
$$;
REVOKE ALL ON FUNCTION public.agenda_inscripcion_permite_apodaca(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_inscripcion_permite_apodaca(UUID) TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_inscripcion_asesor_eligibility(p_expediente_id uuid)
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
  v_has_req BOOLEAN := false;
  v_has_booking BOOLEAN := false;
  v_inscripcion_sede TEXT := 'monterrey';
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'not_authenticated');
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;
  IF v_role IS DISTINCT FROM 'asesor' THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'not_asesor');
  END IF;

  IF p_expediente_id IS NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'expediente_unavailable');
  END IF;

  SELECT e.* INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'expediente_unavailable');
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'org_mismatch');
  END IF;
  IF v_exp.asesor_id IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'not_owner');
  END IF;
  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'ciclo_inactivo');
  END IF;
  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'not_submitted');
  END IF;
  IF v_exp.subestado = 'rechazado' THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'rejected');
  END IF;
  IF NOT public.agenda_inscripcion_etapa_permitida(v_exp.etapa_actual) THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'etapa_fuera');
  END IF;
  IF NOT public.agenda_inscripcion_tiene_biometricos_previos(p_expediente_id) THEN
    RETURN jsonb_build_object('eligible', false, 'reason_code', 'sin_biometricos');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'inscripcion'::public.booking_kind
      AND b.status = 'booked'
  ) INTO v_has_booking;

  SELECT EXISTS (
    SELECT 1 FROM public.agenda_inscripcion_requerimientos r
    WHERE r.expediente_id = p_expediente_id
      AND r.status IN ('pending_booking', 'booked', 'rebook_required')
  ) INTO v_has_req;

  IF public.agenda_inscripcion_permite_apodaca(p_expediente_id) THEN
    v_inscripcion_sede := 'apodaca';
  END IF;

  RETURN jsonb_build_object(
    'eligible', true,
    'reason_code', 'eligible',
    'has_open_requirement', v_has_req,
    'has_active_booking', v_has_booking,
    'location_id', v_inscripcion_sede,
    'fixed_time', '11:00',
    'etapa_actual', v_exp.etapa_actual
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.book_inscripcion_extraordinaria(p_expediente_id uuid, p_booking_date date, p_location_id text, p_note text DEFAULT NULL::text)
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
  IF NOT (v_loc IS NOT DISTINCT FROM 'monterrey'
    OR (v_loc IS NOT DISTINCT FROM 'apodaca' AND public.agenda_inscripcion_permite_apodaca(p_expediente_id))) THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: sede no autorizada para este expediente' USING ERRCODE = '22023';
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
    v_org, v_kind, p_expediente_id, p_booking_date, v_time,
    v_loc, 'booked', v_note, v_actor
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
      'location_id', v_loc,
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
    'location_id', v_loc,
    'requirement_id', v_req.id,
    'requirement_created', v_req_created,
    'etapa_actual', v_etapa,
    'fecha_cita_unchanged', true,
    'mesa_override_sin_bio_crm', v_mesa_override
  );
END;
$function$
;

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
