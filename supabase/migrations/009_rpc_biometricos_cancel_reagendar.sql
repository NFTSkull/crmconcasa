-- ConCasa CRM — P2C-8 RPC cancel_biometricos y reagendar_biometricos

-- =============================================================================
-- cancel_biometricos
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_biometricos(
  p_expediente_id UUID,
  p_motivo TEXT DEFAULT NULL
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
  v_booking RECORD;
  v_motivo TEXT;
  v_fecha_cita_anterior TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'cancel_biometricos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_biometricos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'cancel_biometricos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'cancel_biometricos: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.fecha_cita,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_biometricos: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'cancel_biometricos: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'cancel_biometricos: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'cancel_biometricos: solo el asesor dueño puede cancelar biométricos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'cancel_biometricos: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'cancel_biometricos: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual <> 4 THEN
    RAISE EXCEPTION 'cancel_biometricos: solo se puede cancelar en etapa 4 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  SELECT
    b.id,
    b.booking_date,
    b.booking_time,
    b.location_id,
    b.note
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = 'biometricos'
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancel_biometricos: no hay cita biométrica activa para cancelar'
      USING ERRCODE = '22023';
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN v_motivo IS NOT NULL THEN
        CASE
          WHEN note IS NULL OR btrim(note) = '' THEN 'Cancelado: ' || v_motivo
          ELSE note || E'\nCancelado: ' || v_motivo
        END
      ELSE note
    END
  WHERE id = v_booking.id;

  UPDATE public.expedientes
  SET
    fecha_cita = NULL,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.biometricos.cancel',
    'agenda_booking',
    v_booking.id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'booking_id', v_booking.id,
      'motivo', v_motivo,
      'fecha_cita_anterior', v_fecha_cita_anterior,
      'booking_date', v_booking.booking_date,
      'booking_time', v_booking.booking_time,
      'location_id', v_booking.location_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking.id,
    'status', 'cancelled',
    'fecha_cita', NULL,
    'etapa_actual', 4
  );
END;
$$;

COMMENT ON FUNCTION public.cancel_biometricos(UUID, TEXT) IS
  'Asesor dueño cancela cita biométrica activa (etapa 4). Libera índice parcial; limpia fecha_cita; no cambia etapa.';

-- =============================================================================
-- reagendar_biometricos
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reagendar_biometricos(
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
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
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_biometricos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_biometricos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'reagendar_biometricos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_biometricos: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'reagendar_biometricos: scheduled_at es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_biometricos: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'reagendar_biometricos: la cita debe ser en fecha/hora futura'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.fecha_cita,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_biometricos: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'reagendar_biometricos: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'reagendar_biometricos: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'reagendar_biometricos: solo el asesor dueño puede reagendar biométricos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'reagendar_biometricos: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'reagendar_biometricos: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual <> 4 THEN
    RAISE EXCEPTION 'reagendar_biometricos: solo se puede reagendar en etapa 4 (actual: %)', v_exp.etapa_actual
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
    RAISE EXCEPTION 'reagendar_biometricos: no hay cita biométrica activa para reagendar'
      USING ERRCODE = '22023';
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;
  v_booking_date := (p_scheduled_at AT TIME ZONE current_setting('TIMEZONE'))::date;
  v_booking_time := (p_scheduled_at AT TIME ZONE current_setting('TIMEZONE'))::time;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN note IS NULL OR btrim(note) = '' THEN 'Reagendado'
      ELSE note || E'\nReagendado'
    END
  WHERE id = v_booking_anterior_id;

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
      RAISE EXCEPTION 'reagendar_biometricos: conflicto al crear la nueva cita biométrica'
        USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET
    fecha_cita = p_scheduled_at,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.biometricos.reagendar',
    'agenda_booking',
    v_booking_nuevo_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'booking_anterior_id', v_booking_anterior_id,
      'booking_nuevo_id', v_booking_nuevo_id,
      'fecha_cita_anterior', v_fecha_cita_anterior,
      'fecha_cita_nueva', p_scheduled_at,
      'location_id', v_location_id,
      'note', v_note
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_anterior_id', v_booking_anterior_id,
    'booking_nuevo_id', v_booking_nuevo_id,
    'scheduled_at', p_scheduled_at,
    'status', v_status,
    'kind', v_kind,
    'etapa_actual', 4
  );
END;
$$;

COMMENT ON FUNCTION public.reagendar_biometricos(UUID, TIMESTAMPTZ, TEXT, TEXT) IS
  'Asesor dueño reagenda biométricos (etapa 4): cancela booking activo y crea uno nuevo. No cambia etapa.';

REVOKE ALL ON FUNCTION public.cancel_biometricos(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_biometricos(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reagendar_biometricos(UUID, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reagendar_biometricos(UUID, TIMESTAMPTZ, TEXT, TEXT) FROM anon;

GRANT EXECUTE ON FUNCTION public.cancel_biometricos(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reagendar_biometricos(UUID, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
