-- ConCasa CRM — P119.1: sede real en bookings kind=notificacion
-- Nuevos bookings: location_id = monterrey|apodaca (nunca kind/sentinel).
-- Históricos con location_id=notificacion|NULL → UI «Sin sede» (sin backfill).

CREATE OR REPLACE FUNCTION public.agenda_notificacion_normalize_location_id(
  p_location_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT;
BEGIN
  v := lower(btrim(coalesce(p_location_id, '')));
  IF v IN ('monterrey', 'mty-centro', 'mty_centro', 'sede-centro') THEN
    RETURN 'monterrey';
  END IF;
  IF v IN ('apodaca', 'san-nicolas', 'san_nicolas') THEN
    RETURN 'apodaca';
  END IF;
  RAISE EXCEPTION 'agenda_notificacion: location_id inválido (%) — use monterrey o apodaca', coalesce(p_location_id, '')
    USING ERRCODE = '22023';
END;
$$;

COMMENT ON FUNCTION public.agenda_notificacion_normalize_location_id(TEXT) IS
  'P119.1: normaliza sede de notificación a monterrey|apodaca; rechaza sentinel notificacion.';

REVOKE ALL ON FUNCTION public.agenda_notificacion_normalize_location_id(TEXT) FROM PUBLIC;


DROP FUNCTION IF EXISTS public.book_notificacion_etapa3(UUID, DATE, TEXT);
CREATE OR REPLACE FUNCTION public.book_notificacion_etapa3(p_expediente_id UUID, p_booking_date DATE, p_location_id TEXT, p_note TEXT DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_exp RECORD;
  v_booking_id UUID;
  v_note TEXT;
  v_kind public.booking_kind := 'notificacion';
  v_status public.booking_status := 'booked';
  v_booking_time TIME := TIME '12:00';
  v_location_id TEXT;
  v_tz TEXT := 'America/Monterrey';
  v_scheduled_at TIMESTAMPTZ;
  v_local_noon TIMESTAMP;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: usuario no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_actor_role, v_org_id
  FROM public.profiles p WHERE p.id = v_actor_id AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: perfil no encontrado o inactivo' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: rol no autorizado (%)', v_actor_role USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: expediente_id es obligatorio' USING ERRCODE = '22023';
  END IF;

  IF p_booking_date IS NULL THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: booking_date es obligatorio' USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_location_id := public.agenda_notificacion_normalize_location_id(p_location_id);

  SELECT e.id, e.organization_id, e.asesor_id, e.ciclo_estado, e.submitted_to_mesa,
         e.etapa_actual, e.subestado, e.deleted_at
  INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: expediente no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: expediente no disponible' USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: expediente fuera de la organización del asesor' USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: solo el asesor dueño puede agendar notificación' USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: el expediente no está en ciclo activo' USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: el expediente no ha sido enviado a Mesa' USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual <> 3 THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: solo se puede agendar en etapa 3 (actual: %)', v_exp.etapa_actual USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id AND b.kind = v_kind AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: ya existe una notificación activa para este expediente' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id AND b.kind = 'biometricos' AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: ya existe una cita biométrica activa para este expediente' USING ERRCODE = '22023';
  END IF;

  SELECT NULLIF(btrim(COALESCE(ac.config->>'timezone', '')), '')
  INTO v_tz
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_exp.organization_id AND ac.kind = 'biometricos';
  IF v_tz IS NULL THEN v_tz := 'America/Monterrey'; END IF;

  v_local_noon := (p_booking_date::timestamp + TIME '12:00');
  v_scheduled_at := v_local_noon AT TIME ZONE v_tz;

  IF v_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: la fecha debe ser futura' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time,
      location_id, status, note, created_by
    ) VALUES (
      v_exp.organization_id, v_kind, p_expediente_id, p_booking_date, v_booking_time,
      v_location_id, v_status, v_note, v_actor_id
    ) RETURNING id INTO v_booking_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'book_notificacion_etapa3: ya existe una notificación activa para este expediente' USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET fecha_cita = v_scheduled_at, updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id, v_actor_id, v_actor_role,
    'agenda.notificacion.book', 'agenda_booking', v_booking_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'booking_date', p_booking_date,
      'booking_time', v_booking_time,
      'location_id', v_location_id,
      'booking_kind', v_kind,
      'booking_status', v_status,
      'scheduled_at', v_scheduled_at,
      'note', v_note
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'expediente_id', p_expediente_id,
    'scheduled_at', v_scheduled_at,
    'booking_date', p_booking_date,
    'booking_time', v_booking_time,
    'location_id', v_location_id,
    'status', v_status,
    'kind', v_kind,
    'etapa_actual', v_exp.etapa_actual
  );
END;
$function$;


DROP FUNCTION IF EXISTS public.reagendar_notificacion_etapa3(UUID, DATE, TEXT);
CREATE OR REPLACE FUNCTION public.reagendar_notificacion_etapa3(p_expediente_id UUID, p_booking_date DATE, p_location_id TEXT, p_note TEXT DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_location_id TEXT;
  v_tz TEXT := 'America/Monterrey';
  v_scheduled_at TIMESTAMPTZ;
  v_local_noon TIMESTAMP;
  v_fecha_cita_anterior TIMESTAMPTZ;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: usuario no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_actor_role, v_org_id
  FROM public.profiles p WHERE p.id = v_actor_id AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: perfil no encontrado o inactivo' USING ERRCODE = '42501';
  END IF;

  IF v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: rol no autorizado (%)', v_actor_role USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: expediente_id es obligatorio' USING ERRCODE = '22023';
  END IF;

  IF p_booking_date IS NULL THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: booking_date es obligatorio' USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_location_id := public.agenda_notificacion_normalize_location_id(p_location_id);

  SELECT e.id, e.organization_id, e.asesor_id, e.ciclo_estado, e.submitted_to_mesa,
         e.etapa_actual, e.subestado, e.fecha_cita, e.deleted_at
  INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: expediente no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: expediente no disponible' USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: expediente fuera de la organización del asesor' USING ERRCODE = '42501';
  END IF;

  IF v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: solo el asesor dueño puede reagendar notificación' USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: el expediente no está en ciclo activo' USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: el expediente no ha sido enviado a Mesa' USING ERRCODE = '22023';
  END IF;

  IF v_exp.etapa_actual <> 3 THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: solo se puede reagendar en etapa 3 (actual: %)', v_exp.etapa_actual USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: no hay notificación activa para reagendar' USING ERRCODE = '22023';
  END IF;

  SELECT NULLIF(btrim(COALESCE(ac.config->>'timezone', '')), '')
  INTO v_tz
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_exp.organization_id AND ac.kind = 'biometricos';
  IF v_tz IS NULL THEN v_tz := 'America/Monterrey'; END IF;

  v_local_noon := (p_booking_date::timestamp + TIME '12:00');
  v_scheduled_at := v_local_noon AT TIME ZONE v_tz;

  IF v_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: la fecha debe ser futura' USING ERRCODE = '22023';
  END IF;

  v_fecha_cita_anterior := v_exp.fecha_cita;

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
      organization_id, kind, expediente_id, booking_date, booking_time,
      location_id, status, note, created_by
    ) VALUES (
      v_exp.organization_id, v_kind, p_expediente_id, p_booking_date, v_booking_time,
      v_location_id, v_status, v_note, v_actor_id
    ) RETURNING id INTO v_booking_nuevo_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'reagendar_notificacion_etapa3: ya existe una notificación activa para este expediente' USING ERRCODE = '22023';
  END;

  UPDATE public.expedientes
  SET fecha_cita = v_scheduled_at, updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id, v_actor_id, v_actor_role,
    'agenda.notificacion.reagendar', 'agenda_booking', v_booking_nuevo_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'booking_anterior_id', v_booking_anterior_id,
      'booking_nuevo_id', v_booking_nuevo_id,
      'booking_date', p_booking_date,
      'booking_time', v_booking_time,
      'scheduled_at', v_scheduled_at,
      'fecha_cita_anterior', v_fecha_cita_anterior,
      'etapa_actual', v_exp.etapa_actual,
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
$function$;


DROP FUNCTION IF EXISTS public.mesa_reagendar_notificacion(UUID, DATE, TEXT);
CREATE OR REPLACE FUNCTION public.mesa_reagendar_notificacion(p_expediente_id UUID, p_booking_date DATE, p_location_id TEXT, p_note TEXT DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_location_id TEXT;
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
  v_location_id := public.agenda_notificacion_normalize_location_id(p_location_id);
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
$function$;


DROP FUNCTION IF EXISTS public.convert_biometricos_to_notificacion(UUID, DATE, TEXT);
CREATE OR REPLACE FUNCTION public.convert_biometricos_to_notificacion(p_expediente_id UUID, p_booking_date DATE, p_location_id TEXT, p_note TEXT DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_location_id TEXT;
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
  v_location_id := public.agenda_notificacion_normalize_location_id(p_location_id);

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
$function$;



GRANT EXECUTE ON FUNCTION public.book_notificacion_etapa3(UUID, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reagendar_notificacion_etapa3(UUID, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_reagendar_notificacion(UUID, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_biometricos_to_notificacion(UUID, DATE, TEXT, TEXT) TO authenticated;

-- Actualizar mesa_gestionar_cita para pasar sede en reagenda notificación
CREATE OR REPLACE FUNCTION public.mesa_gestionar_cita(
  p_booking_id UUID,
  p_action TEXT,
  p_motivo TEXT,
  p_new_scheduled_at TIMESTAMPTZ DEFAULT NULL,
  p_new_location_id TEXT DEFAULT NULL,
  p_new_booking_date DATE DEFAULT NULL
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
  v_b public.agenda_bookings%ROWTYPE;
  v_motivo TEXT;
  v_action TEXT;
  v_result JSONB;
  v_new_booking_id UUID;
  v_decision_id UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  v_action := lower(btrim(COALESCE(p_action, '')));
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: motivo obligatorio' USING ERRCODE = '22023';
  END IF;

  -- P118b: cancelar y continuar → RPC dedicada (solo mesa_admin/super_admin dentro)
  IF v_action IN ('cancelar_continuar', 'cancel_continue') THEN
    v_result := public.mesa_cancelar_cita_y_continuar(p_booking_id, v_motivo);
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'cancel_continue',
      'decision_id', v_result->>'decision_id',
      'result', v_result
    );
  END IF;

  SELECT * INTO v_b
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: booking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_role <> 'super_admin' AND v_b.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: org distinta' USING ERRCODE = '42501';
  END IF;

  IF v_b.status <> 'booked' THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: booking no activo' USING ERRCODE = '22023';
  END IF;

  IF v_action = 'cancelar' THEN
    IF v_b.kind = 'biometricos' THEN
      v_result := public.cancel_biometricos(v_b.expediente_id, v_motivo);
    ELSIF v_b.kind = 'firmas' THEN
      IF to_regprocedure('public.mesa_cancel_firmas(uuid,text)') IS NOT NULL THEN
        v_result := public.mesa_cancel_firmas(v_b.expediente_id, v_motivo);
      ELSE
        v_result := public.cancel_firmas(v_b.expediente_id, v_motivo);
      END IF;
    ELSIF v_b.kind = 'notificacion' THEN
      IF v_role NOT IN ('mesa_admin', 'super_admin') THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: cancelar notificación solo mesa_admin/super_admin'
          USING ERRCODE = '42501';
      END IF;
      v_result := public.cancel_notificacion_etapa3(v_b.expediente_id, v_motivo);
    ELSE
      RAISE EXCEPTION 'mesa_gestionar_cita: kind no soportado' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.agenda_booking_decisiones (
      organization_id, expediente_id, booking_id, kind, decision, motivo, decided_by,
      previous_booking_date, previous_booking_time, previous_location_id
    ) VALUES (
      v_b.organization_id, v_b.expediente_id, v_b.id, v_b.kind, 'cancelar', v_motivo, v_actor,
      v_b.booking_date, v_b.booking_time, v_b.location_id
    ) RETURNING id INTO v_decision_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'cancelar',
      'decision_id', v_decision_id,
      'result', v_result
    );
  END IF;

  IF v_action = 'reagendar' THEN
    IF v_b.kind = 'biometricos' THEN
      IF p_new_scheduled_at IS NULL OR NULLIF(btrim(COALESCE(p_new_location_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar biométricos exige fecha/hora y sede'
          USING ERRCODE = '22023';
      END IF;
      IF v_role NOT IN ('mesa_admin', 'super_admin') THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar biométricos solo mesa_admin/super_admin'
          USING ERRCODE = '42501';
      END IF;
      v_result := public.mesa_reagendar_biometricos(
        v_b.expediente_id,
        (p_new_scheduled_at AT TIME ZONE 'America/Monterrey')::DATE,
        (p_new_scheduled_at AT TIME ZONE 'America/Monterrey')::TIME,
        NULLIF(btrim(p_new_location_id), ''),
        v_motivo
      );
    ELSIF v_b.kind = 'firmas' THEN
      IF p_new_scheduled_at IS NULL OR NULLIF(btrim(COALESCE(p_new_location_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar firmas exige fecha/hora y sede'
          USING ERRCODE = '22023';
      END IF;
      v_result := public.mesa_reagendar_firmas(
        v_b.expediente_id,
        p_new_scheduled_at,
        'America/Monterrey',
        NULLIF(btrim(p_new_location_id), ''),
        v_motivo
      );
    ELSIF v_b.kind = 'notificacion' THEN
      IF p_new_booking_date IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar notificación exige fecha'
          USING ERRCODE = '22023';
      END IF;
      IF v_role NOT IN ('mesa_admin', 'super_admin') THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar notificación solo mesa_admin/super_admin'
          USING ERRCODE = '42501';
      END IF;
      IF NULLIF(btrim(COALESCE(p_new_location_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar notificación exige sede (monterrey|apodaca)'
          USING ERRCODE = '22023';
      END IF;
      v_result := public.mesa_reagendar_notificacion(
        v_b.expediente_id, p_new_booking_date, p_new_location_id, v_motivo
      );
    ELSE
      RAISE EXCEPTION 'mesa_gestionar_cita: kind no soportado' USING ERRCODE = '22023';
    END IF;

    SELECT b.id INTO v_new_booking_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = v_b.expediente_id
      AND b.kind = v_b.kind
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    INSERT INTO public.agenda_booking_decisiones (
      organization_id, expediente_id, booking_id, kind, decision, motivo, decided_by,
      previous_booking_date, previous_booking_time, previous_location_id,
      new_booking_date, new_booking_time, new_location_id, new_booking_id
    )
    SELECT
      v_b.organization_id, v_b.expediente_id, v_b.id, v_b.kind, 'reagendar', v_motivo, v_actor,
      v_b.booking_date, v_b.booking_time, v_b.location_id,
      nb.booking_date, nb.booking_time, nb.location_id, nb.id
    FROM public.agenda_bookings nb
    WHERE nb.id = v_new_booking_id
    RETURNING id INTO v_decision_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'reagendar',
      'decision_id', v_decision_id,
      'new_booking_id', v_new_booking_id,
      'result', v_result
    );
  END IF;

  RAISE EXCEPTION 'mesa_gestionar_cita: acción no reconocida (%)', p_action
    USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_gestionar_cita(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesa_gestionar_cita(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE) TO authenticated;



REVOKE ALL ON FUNCTION public.book_notificacion_etapa3(UUID, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.book_notificacion_etapa3(UUID, DATE, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reagendar_notificacion_etapa3(UUID, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reagendar_notificacion_etapa3(UUID, DATE, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.mesa_reagendar_notificacion(UUID, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_reagendar_notificacion(UUID, DATE, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.convert_biometricos_to_notificacion(UUID, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_biometricos_to_notificacion(UUID, DATE, TEXT, TEXT) FROM anon;
