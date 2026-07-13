-- ConCasa CRM — P068 Mesa reagenda biométricos y notificación desde agenda
-- Roles: mesa_admin, super_admin. Conserva historial (cancel + insert). Sin tocar reagendar_firmas.

CREATE OR REPLACE FUNCTION public.mesa_reagendar_biometricos(
  p_expediente_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_location_id TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_booking_anterior_id UUID;
  v_booking_nuevo_id UUID;
  v_location_id TEXT;
  v_note TEXT;
  v_booking_date DATE;
  v_booking_time TIME;
  v_fecha_cita_anterior TIMESTAMPTZ;
  v_kind public.booking_kind := 'biometricos';
  v_status public.booking_status := 'booked';
  v_agenda_meta JSONB;
  v_tz TEXT;
  v_local_ts TIMESTAMP;
  v_scheduled_at TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: booking_date y booking_time son obligatorios'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL THEN
    v_note := 'Reagendado por Mesa: ' || v_note;
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.fecha_cita,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (3, 4, 5) THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: solo se puede reagendar en etapa 3, 4 o 5 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  SELECT b.id
  INTO v_booking_anterior_id
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = v_kind
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_booking_anterior_id IS NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: no hay cita biométrica activa para reagendar'
      USING ERRCODE = '22023';
  END IF;

  SELECT NULLIF(btrim(COALESCE(ac.config->>'timezone', '')), '')
  INTO v_tz
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_exp.organization_id
    AND ac.kind = 'biometricos';

  IF v_tz IS NULL THEN
    v_tz := 'America/Monterrey';
  END IF;

  v_local_ts := (p_booking_date::timestamp + p_booking_time);
  v_scheduled_at := v_local_ts AT TIME ZONE v_tz;

  IF v_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'mesa_reagendar_biometricos: la cita debe ser en fecha/hora futura'
      USING ERRCODE = '22023';
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN note IS NULL OR btrim(note) = '' THEN 'Reagendado por Mesa'
      ELSE note || E'\nReagendado por Mesa'
    END
  WHERE id = v_booking_anterior_id;

  v_agenda_meta := public.agenda_biometricos_assert_slot_available(
    v_exp.organization_id,
    v_scheduled_at,
    v_location_id
  );

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;

  BEGIN
    INSERT INTO public.agenda_bookings (
      organization_id,
      kind,
      expediente_id,
      booking_date,
      booking_time,
      location_id,
      status,
      note,
      created_by
    ) VALUES (
      v_exp.organization_id,
      v_kind,
      p_expediente_id,
      v_booking_date,
      v_booking_time,
      v_location_id,
      v_status,
      v_note,
      v_actor_id
    )
    RETURNING id INTO v_booking_nuevo_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'mesa_reagendar_biometricos: conflicto al crear la nueva cita biométrica'
        USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET
    fecha_cita = v_scheduled_at,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.biometricos.mesa_reagendar',
    'agenda_booking',
    v_booking_nuevo_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'booking_anterior_id', v_booking_anterior_id,
      'booking_nuevo_id', v_booking_nuevo_id,
      'fecha_cita_anterior', v_fecha_cita_anterior,
      'fecha_cita_nueva', v_scheduled_at,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'note', v_note,
      'agenda_config_applied', true,
      'capacity_per_slot', v_agenda_meta->'capacity_per_slot',
      'booked_count_before', v_agenda_meta->'booked_count_before'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_anterior_id', v_booking_anterior_id,
    'booking_nuevo_id', v_booking_nuevo_id,
    'scheduled_at', v_scheduled_at,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'status', v_status,
    'kind', v_kind,
    'etapa_actual', v_exp.etapa_actual
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_reagendar_biometricos(UUID, DATE, TIME, TEXT, TEXT) IS
  'Mesa admin/super_admin reagenda biométricos: cancela booking activo + inserta nuevo; valida cupo; no cambia etapa.';

REVOKE ALL ON FUNCTION public.mesa_reagendar_biometricos(UUID, DATE, TIME, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesa_reagendar_biometricos(UUID, DATE, TIME, TEXT, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.mesa_reagendar_notificacion(
  p_expediente_id UUID,
  p_booking_date DATE,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_booking_anterior_id UUID;
  v_booking_nuevo_id UUID;
  v_note TEXT;
  v_kind public.booking_kind := 'notificacion';
  v_status public.booking_status := 'booked';
  v_booking_time TIME := TIME '12:00';
  v_location_id TEXT := 'notificacion';
  v_tz TEXT := 'America/Monterrey';
  v_scheduled_at TIMESTAMPTZ;
  v_local_noon TIMESTAMP;
  v_fecha_cita_anterior TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: usuario no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_actor_role, v_org_id
  FROM public.profiles p WHERE p.id = v_actor_id AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: perfil no encontrado o inactivo' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: rol no autorizado (%)', v_actor_role USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: expediente_id es obligatorio' USING ERRCODE = '22023';
  END IF;

  IF p_booking_date IS NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: booking_date es obligatorio' USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL THEN
    v_note := 'Reagendado por Mesa: ' || v_note;
  END IF;

  SELECT e.id, e.organization_id, e.asesor_id, e.ciclo_estado, e.submitted_to_mesa,
         e.etapa_actual, e.subestado, e.fecha_cita, e.deleted_at
  INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: expediente no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: expediente no disponible' USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: expediente fuera de la organización del actor' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: no autorizado para operar este expediente' USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: el expediente no está en ciclo activo' USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: el expediente no ha sido enviado a Mesa' USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: subestado debe ser en_proceso (actual: %)', v_exp.subestado USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual <> 3 THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: solo se puede reagendar en etapa 3 (actual: %)', v_exp.etapa_actual USING ERRCODE = '22023';
  END IF;

  SELECT b.id INTO v_booking_anterior_id
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = v_kind
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_booking_anterior_id IS NULL THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: no hay notificación activa para reagendar' USING ERRCODE = '22023';
  END IF;

  SELECT NULLIF(btrim(COALESCE(ac.config->>'timezone', '')), '')
  INTO v_tz
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_exp.organization_id AND ac.kind = 'biometricos';
  IF v_tz IS NULL THEN v_tz := 'America/Monterrey'; END IF;

  v_local_noon := (p_booking_date::timestamp + TIME '12:00');
  v_scheduled_at := v_local_noon AT TIME ZONE v_tz;

  IF v_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: la fecha debe ser futura' USING ERRCODE = '22023';
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN note IS NULL OR btrim(note) = '' THEN 'Reagendado por Mesa'
      ELSE note || E'\nReagendado por Mesa'
    END
  WHERE id = v_booking_anterior_id;

  BEGIN
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time,
      location_id, status, note, created_by
    ) VALUES (
      v_exp.organization_id, v_kind, p_expediente_id, p_booking_date, v_booking_time,
      v_location_id, v_status, v_note, v_actor_id
    ) RETURNING id INTO v_booking_nuevo_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'mesa_reagendar_notificacion: ya existe una notificación activa para este expediente' USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET fecha_cita = v_scheduled_at, updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id, v_actor_id, v_actor_role,
    'agenda.notificacion.mesa_reagendar', 'agenda_booking', v_booking_nuevo_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'booking_anterior_id', v_booking_anterior_id,
      'booking_nuevo_id', v_booking_nuevo_id,
      'booking_date', p_booking_date,
      'booking_time', v_booking_time,
      'scheduled_at', v_scheduled_at,
      'fecha_cita_anterior', v_fecha_cita_anterior,
      'etapa_actual', v_exp.etapa_actual,
      'note', v_note,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_anterior_id', v_booking_anterior_id,
    'booking_nuevo_id', v_booking_nuevo_id,
    'booking_id', v_booking_nuevo_id,
    'scheduled_at', v_scheduled_at,
    'booking_date', p_booking_date,
    'booking_time', v_booking_time,
    'status', v_status,
    'kind', v_kind,
    'etapa_actual', v_exp.etapa_actual
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_reagendar_notificacion(UUID, DATE, TEXT) IS
  'Mesa admin/super_admin reagenda notificación en etapa 3: cancela anterior + nueva a las 12:00; sin cupo; no cambia etapa.';

REVOKE ALL ON FUNCTION public.mesa_reagendar_notificacion(UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesa_reagendar_notificacion(UUID, DATE, TEXT) TO authenticated;
