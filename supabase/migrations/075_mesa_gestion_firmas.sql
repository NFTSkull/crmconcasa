-- ConCasa CRM — P075: gestión de firmas exclusiva de Mesa Control
-- No modifica book_firmas/reagendar_firmas/cancel_firmas ni el flujo del asesor.

CREATE OR REPLACE FUNCTION public.mesa_book_firmas(
  p_expediente_id UUID,
  p_booking_at TIMESTAMPTZ,
  p_timezone TEXT,
  p_location_id TEXT,
  p_nota TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_booking_id UUID;
  v_timezone TEXT;
  v_location_id TEXT;
  v_nota TEXT;
  v_agenda_meta JSONB;
  v_booking_date DATE;
  v_booking_time TIME;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: perfil inactivo o rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente_id obligatorio'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_booking_at IS NULL OR p_booking_at <= NOW() THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_DATE: fecha de firma debe ser futura'
      USING ERRCODE = '22023';
  END IF;

  v_timezone := NULLIF(btrim(COALESCE(p_timezone, '')), '');
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_LOCATION: sede obligatoria'
      USING ERRCODE = '22023';
  END IF;
  v_nota := NULLIF(btrim(COALESCE(p_nota, '')), '');

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente no encontrado o no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STATE: expediente no elegible para agenda'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STAGE: solo etapas 9 o 10'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'firmas'
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_ALREADY_BOOKED: ya existe una firma activa'
      USING ERRCODE = '22023';
  END IF;

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_booking_at,
    v_location_id
  );

  IF v_agenda_meta->>'timezone' IS DISTINCT FROM v_timezone THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone debe coincidir con agenda_config (%)',
      v_agenda_meta->>'timezone'
      USING ERRCODE = '22023';
  END IF;

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
      'firmas',
      p_expediente_id,
      v_booking_date,
      v_booking_time,
      v_location_id,
      'booked',
      v_nota,
      v_actor_id
    )
    RETURNING id INTO v_booking_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_ALREADY_BOOKED: conflicto de firma activa'
      USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET fecha_cita = p_booking_at, updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.mesa_book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'booking_id', v_booking_id,
      'expediente_id', p_expediente_id,
      'booking_at', p_booking_at,
      'timezone', v_timezone,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'etapa_actual', v_exp.etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking_id,
    'booking_at', p_booking_at,
    'timezone', v_timezone,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'etapa_actual', v_exp.etapa_actual
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mesa_reagendar_firmas(
  p_expediente_id UUID,
  p_booking_at TIMESTAMPTZ,
  p_timezone TEXT,
  p_location_id TEXT,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_booking RECORD;
  v_new_booking_id UUID;
  v_timezone TEXT;
  v_location_id TEXT;
  v_motivo TEXT;
  v_agenda_meta JSONB;
  v_booking_date DATE;
  v_booking_time TIME;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: perfil inactivo o rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_at IS NULL OR p_booking_at <= NOW() THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_DATE: fecha de firma debe ser futura'
      USING ERRCODE = '22023';
  END IF;

  v_timezone := NULLIF(btrim(COALESCE(p_timezone, '')), '');
  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone obligatorio'
      USING ERRCODE = '22023';
  END IF;
  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_LOCATION: sede obligatoria'
      USING ERRCODE = '22023';
  END IF;
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_REASON_REQUIRED: motivo obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente no encontrado o no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STATE: expediente no elegible para agenda'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STAGE: solo etapas 9 o 10'
      USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.booking_date, b.booking_time, b.location_id, b.note
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = 'firmas'
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NO_ACTIVE_BOOKING: no hay firma activa'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = concat_ws(
      E'\n',
      NULLIF(btrim(COALESCE(note, '')), ''),
      'Reagendada por Mesa: ' || v_motivo
    )
  WHERE id = v_booking.id;

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_booking_at,
    v_location_id
  );

  IF v_agenda_meta->>'timezone' IS DISTINCT FROM v_timezone THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_TIMEZONE: timezone debe coincidir con agenda_config (%)',
      v_agenda_meta->>'timezone'
      USING ERRCODE = '22023';
  END IF;

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;

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
    'firmas',
    p_expediente_id,
    v_booking_date,
    v_booking_time,
    v_location_id,
    'booked',
    'Reagenda Mesa: ' || v_motivo,
    v_actor_id
  )
  RETURNING id INTO v_new_booking_id;

  UPDATE public.expedientes
  SET fecha_cita = p_booking_at, updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.mesa_reagendar',
    'agenda_booking',
    v_new_booking_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'old_booking_id', v_booking.id,
      'new_booking_id', v_new_booking_id,
      'expediente_id', p_expediente_id,
      'booking_at', p_booking_at,
      'timezone', v_timezone,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'motivo', v_motivo,
      'etapa_actual', v_exp.etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'old_booking_id', v_booking.id,
    'new_booking_id', v_new_booking_id,
    'booking_at', p_booking_at,
    'timezone', v_timezone,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'etapa_actual', v_exp.etapa_actual
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mesa_cancel_firmas(
  p_expediente_id UUID,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_booking RECORD;
  v_motivo TEXT;
  v_clear_fecha_cita BOOLEAN;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_UNAUTHORIZED: perfil inactivo o rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_REASON_REQUIRED: motivo obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_FOUND: expediente no encontrado o no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.ciclo_estado <> 'activo'
     OR v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_BAD_STATE: expediente no elegible para cancelación'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NOT_VISIBLE: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  SELECT b.id
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = 'firmas'
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MESA_SIGNATURE_NO_ACTIVE_BOOKING: no hay firma activa'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = concat_ws(
      E'\n',
      NULLIF(btrim(COALESCE(note, '')), ''),
      'Cancelada por Mesa: ' || v_motivo
    )
  WHERE id = v_booking.id;

  v_clear_fecha_cita := NOT EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.status = 'booked'
  );

  IF v_clear_fecha_cita THEN
    UPDATE public.expedientes
    SET fecha_cita = NULL, updated_at = NOW()
    WHERE id = p_expediente_id;
  END IF;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.mesa_cancel',
    'agenda_booking',
    v_booking.id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'booking_id', v_booking.id,
      'expediente_id', p_expediente_id,
      'motivo', v_motivo,
      'etapa_actual', v_exp.etapa_actual,
      'fecha_cita_cleared', v_clear_fecha_cita,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking.id,
    'status', 'cancelled',
    'etapa_actual', v_exp.etapa_actual,
    'fecha_cita_cleared', v_clear_fecha_cita
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_book_firmas(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT) IS
  'Agenda firmas para un expediente visible en etapa 9/10. Exclusiva de roles Mesa; no cambia etapa.';
COMMENT ON FUNCTION public.mesa_reagendar_firmas(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT) IS
  'Reagenda atómicamente una firma activa para roles Mesa en etapa 9/10; no cambia etapa.';
COMMENT ON FUNCTION public.mesa_cancel_firmas(UUID, TEXT) IS
  'Cancela explícitamente una firma activa visible para Mesa, incluso tras movimiento manual fuera de etapa 9/10; no cambia etapa.';

REVOKE ALL ON FUNCTION public.mesa_book_firmas(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mesa_reagendar_firmas(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mesa_cancel_firmas(UUID, TEXT)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.mesa_book_firmas(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.mesa_reagendar_firmas(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.mesa_cancel_firmas(UUID, TEXT)
  TO authenticated, service_role, postgres;
