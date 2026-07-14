-- ConCasa CRM — P070: conversión extraordinaria Biométricos → Notificación (asesor)
-- Atómico: cancela bio booked, inserta notificacion 12:00, etapa 4→3 (legacy 3 permanece),
-- actualiza fecha_cita. Sin cupo. No muta kind in-place.

CREATE OR REPLACE FUNCTION public.convert_biometricos_to_notificacion(
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
  v_bio RECORD;
  v_notif_id UUID;
  v_note TEXT;
  v_convert_note TEXT := 'Convertido a Notificación extraordinaria';
  v_booking_time TIME := TIME '12:00';
  v_location_id TEXT := 'notificacion';
  v_tz TEXT := 'America/Monterrey';
  v_scheduled_at TIMESTAMPTZ;
  v_local_noon TIMESTAMP;
  v_etapa_anterior SMALLINT;
  v_etapa_nueva SMALLINT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_booking_date IS NULL THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: booking_date es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

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
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: expediente no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: expediente fuera de la organización del asesor'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: solo el asesor dueño puede convertir'
      USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: el expediente no está en ciclo activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: el expediente no ha sido enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: subestado debe ser en_proceso (actual: %)', v_exp.subestado
      USING ERRCODE = '22023';
  END IF;

  -- Etapa 4 (flujo normal) o etapa 3 legacy con bio activo.
  IF v_exp.etapa_actual NOT IN (3, 4) THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: solo etapas 3 o 4 (actual: %)', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  SELECT
    b.id,
    b.booking_date,
    b.booking_time,
    b.location_id,
    b.note,
    b.status
  INTO v_bio
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = 'biometricos'
    AND b.status = 'booked'
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: no hay cita biométrica activa'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'notificacion'
      AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: ya existe una notificación activa'
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

  v_local_noon := (p_booking_date::timestamp + TIME '12:00');
  v_scheduled_at := v_local_noon AT TIME ZONE v_tz;

  IF v_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'convert_biometricos_to_notificacion: la fecha debe ser futura'
      USING ERRCODE = '22023';
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;
  v_etapa_nueva := 3;

  UPDATE public.agenda_bookings
  SET
    status = 'cancelled',
    cancelled_at = NOW(),
    note = CASE
      WHEN note IS NULL OR btrim(note) = '' THEN v_convert_note
      ELSE note || E'\n' || v_convert_note
    END
  WHERE id = v_bio.id;

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
      'notificacion',
      p_expediente_id,
      p_booking_date,
      v_booking_time,
      v_location_id,
      'booked',
      v_note,
      v_actor_id
    )
    RETURNING id INTO v_notif_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'convert_biometricos_to_notificacion: ya existe una notificación activa'
        USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET
    etapa_actual = v_etapa_nueva,
    fecha_cita = v_scheduled_at,
    subestado = 'en_proceso',
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.biometricos.convert_to_notificacion',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'actor_id', v_actor_id,
      'actor_role', v_actor_role,
      'expediente_id', p_expediente_id,
      'biometricos_booking_id', v_bio.id,
      'notificacion_booking_id', v_notif_id,
      'booking_date', p_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'scheduled_at', v_scheduled_at,
      'etapa_anterior', v_etapa_anterior,
      'etapa_nueva', v_etapa_nueva,
      'fecha_cita_anterior', v_exp.fecha_cita,
      'note', v_note,
      'convert_note', v_convert_note
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'biometricos_booking_id', v_bio.id,
    'notificacion_booking_id', v_notif_id,
    'booking_date', p_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'scheduled_at', v_scheduled_at,
    'etapa_anterior', v_etapa_anterior,
    'etapa_actual', v_etapa_nueva,
    'status_biometricos', 'cancelled',
    'status_notificacion', 'booked'
  );
END;
$$;

COMMENT ON FUNCTION public.convert_biometricos_to_notificacion(UUID, DATE, TEXT) IS
  'P070: asesor dueño convierte bio booked → notificacion (12:00). Cancela bio, inserta notif, etapa 4→3 (legacy 3 se mantiene). Atómico.';

REVOKE ALL ON FUNCTION public.convert_biometricos_to_notificacion(UUID, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_biometricos_to_notificacion(UUID, DATE, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.convert_biometricos_to_notificacion(UUID, DATE, TEXT) TO authenticated;
