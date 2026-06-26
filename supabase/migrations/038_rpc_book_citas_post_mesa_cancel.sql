-- ConCasa CRM — 038: book tras cancel Mesa en etapa 5 (bio) / 10 (firmas)
-- No toca reagendar_*; no cambia etapa.

CREATE OR REPLACE FUNCTION public.book_biometricos(
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT NULL,
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
  v_booking_id UUID;
  v_location_id TEXT;
  v_note TEXT;
  v_booking_date DATE;
  v_booking_time TIME;
  v_kind public.booking_kind := 'biometricos';
  v_status public.booking_status := 'booked';
  v_agenda_meta JSONB;
  v_etapa_actual SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_biometricos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'book_biometricos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: scheduled_at es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'book_biometricos: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'book_biometricos: la cita debe ser en fecha/hora futura'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_biometricos: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_biometricos: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'book_biometricos: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'book_biometricos: solo el asesor dueño puede agendar biométricos'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'book_biometricos: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'book_biometricos: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (4, 5) THEN
    RAISE EXCEPTION 'book_biometricos: solo se puede agendar en etapa 4 o 5 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = v_kind
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_biometricos: ya existe una cita biométrica activa para este expediente'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual = 5 THEN
    IF v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'book_biometricos: etapa 5 requiere subestado en_proceso (actual: %)', v_exp.subestado
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.agenda_bookings b
      WHERE b.expediente_id = p_expediente_id
        AND b.kind = v_kind
        AND b.status = 'cancelled'
        AND b.id = (
          SELECT b2.id
          FROM public.agenda_bookings b2
          WHERE b2.expediente_id = p_expediente_id
            AND b2.kind = v_kind
          ORDER BY b2.created_at DESC
          LIMIT 1
        )
    ) THEN
      RAISE EXCEPTION 'book_biometricos: etapa 5 requiere que la última cita biométrica esté cancelada'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_agenda_meta := public.agenda_biometricos_assert_slot_available(
    v_exp.organization_id,
    p_scheduled_at,
    v_location_id
  );

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;
  v_etapa_actual := v_exp.etapa_actual;

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
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'book_biometricos: ya existe una cita biométrica activa para este expediente'
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
    'agenda.biometricos.book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'asesor_id', v_exp.asesor_id,
      'organization_id', v_exp.organization_id,
      'scheduled_at', p_scheduled_at,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'note', v_note,
      'booking_kind', v_kind,
      'booking_status', v_status,
      'agenda_config_applied', true,
      'capacity_per_slot', v_agenda_meta->'capacity_per_slot',
      'booked_count_before', v_agenda_meta->'booked_count_before'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'expediente_id', p_expediente_id,
    'scheduled_at', p_scheduled_at,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'status', v_status,
    'kind', v_kind,
    'etapa_actual', v_etapa_actual
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.book_firmas(
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT NULL,
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
  v_booking_id UUID;
  v_location_id TEXT;
  v_note TEXT;
  v_booking_date DATE;
  v_booking_time TIME;
  v_kind public.booking_kind := 'firmas';
  v_status public.booking_status := 'booked';
  v_agenda_meta JSONB;
  v_etapa_actual SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'book_firmas: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_firmas: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('asesor', 'mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'book_firmas: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'book_firmas: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'book_firmas: scheduled_at es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_location_id := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'book_firmas: location_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'book_firmas: la cita debe ser en fecha/hora futura'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_firmas: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_firmas: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'book_firmas: expediente fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role = 'asesor'
     AND v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'book_firmas: solo el asesor dueño puede agendar firma'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role IN ('mesa_admin', 'super_admin')
     AND NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'book_firmas: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'book_firmas: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'book_firmas: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'book_firmas: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual NOT IN (9, 10) THEN
    RAISE EXCEPTION 'book_firmas: solo se puede agendar en etapa 9 o 10 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = v_kind
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_firmas: ya existe una cita de firma activa para este expediente'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual = 10 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.agenda_bookings b
      WHERE b.expediente_id = p_expediente_id
        AND b.kind = v_kind
        AND b.status = 'cancelled'
        AND b.id = (
          SELECT b2.id
          FROM public.agenda_bookings b2
          WHERE b2.expediente_id = p_expediente_id
            AND b2.kind = v_kind
          ORDER BY b2.created_at DESC
          LIMIT 1
        )
    ) THEN
      RAISE EXCEPTION 'book_firmas: etapa 10 requiere que la última cita de firma esté cancelada'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_agenda_meta := public.agenda_firmas_assert_slot_available(
    v_exp.organization_id,
    p_scheduled_at,
    v_location_id
  );

  v_booking_date := (v_agenda_meta->>'booking_date')::DATE;
  v_booking_time := (v_agenda_meta->>'booking_time')::TIME;
  v_etapa_actual := v_exp.etapa_actual;

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
    RETURNING id INTO v_booking_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'book_firmas: ya existe una cita de firma activa para este expediente'
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
    'agenda.firmas.book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'booking_id', v_booking_id,
      'expediente_id', p_expediente_id,
      'scheduled_at', p_scheduled_at,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'etapa_actual', v_etapa_actual,
      'no_etapa_change', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'booking_id', v_booking_id,
    'kind', v_kind,
    'scheduled_at', p_scheduled_at,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'fecha_cita', p_scheduled_at,
    'etapa_actual', v_etapa_actual,
    'no_etapa_change', true
  );
END;
$$;

COMMENT ON FUNCTION public.book_biometricos(UUID, TIMESTAMPTZ, TEXT, TEXT) IS
  'Asesor agenda biométricos etapa 4 (normal) o 5 (tras cancel Mesa: subestado en_proceso + última cita cancelada). No cambia etapa.';
COMMENT ON FUNCTION public.book_firmas(UUID, TIMESTAMPTZ, TEXT, TEXT) IS
  'Asesor/mesa agenda firmas etapa 9 (normal) o 10 (tras cancel Mesa: última cita cancelada). No cambia etapa.';
