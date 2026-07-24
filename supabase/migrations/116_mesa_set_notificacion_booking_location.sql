-- ConCasa CRM — P131: asignar sede canónica a bookings kind=notificacion
-- RPC mesa_set_notificacion_booking_location (solo location_id + updated_at).
-- Backfill recuperable: legacy IDs estructurados (mty-centro, san-nicolas, …).
-- NULL / '' / 'notificacion' → UI «Asignar sede» (sin inventar).

-- =============================================================================
-- A) Helper: ¿ubicación actual es asignable (inválida / legacy no canónica)?
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_notificacion_location_needs_assignment(
  p_location_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_location_id IS NULL OR btrim(p_location_id) = '' THEN TRUE
    WHEN lower(btrim(p_location_id)) IN ('monterrey', 'apodaca') THEN FALSE
    ELSE TRUE
  END;
$$;

COMMENT ON FUNCTION public.agenda_notificacion_location_needs_assignment(TEXT) IS
  'P131: true si location_id de notificación no es monterrey|apodaca.';

REVOKE ALL ON FUNCTION public.agenda_notificacion_location_needs_assignment(TEXT) FROM PUBLIC;

-- =============================================================================
-- B) Backfill recuperable (evidencia = location_id legacy estructurado)
-- =============================================================================
DO $$
DECLARE
  r RECORD;
  v_new TEXT;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT
      b.id,
      b.organization_id,
      b.expediente_id,
      b.location_id,
      b.booking_date,
      b.booking_time,
      b.status,
      b.kind
    FROM public.agenda_bookings b
    WHERE b.kind = 'notificacion'
      AND lower(btrim(coalesce(b.location_id, ''))) IN (
        'mty-centro', 'mty_centro', 'sede-centro',
        'san-nicolas', 'san_nicolas'
      )
  LOOP
    v_new := public.agenda_notificacion_normalize_location_id(r.location_id);
    UPDATE public.agenda_bookings
    SET location_id = v_new
    WHERE id = r.id
      AND location_id IS DISTINCT FROM v_new;

    PERFORM public.log_action(
      r.organization_id,
      NULL,
      'super_admin'::public.app_role,
      'agenda.notificacion.location_backfill',
      'agenda_booking',
      r.id,
      jsonb_build_object(
        'booking_id', r.id,
        'expediente_id', r.expediente_id,
        'previous_location_id', r.location_id,
        'new_location_id', v_new,
        'source', 'structured_location_id_legacy',
        'booking_date', r.booking_date,
        'booking_time', r.booking_time,
        'status', r.status,
        'kind', r.kind
      )
    );
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'P131 backfill notificacion legacy locations: % filas', v_count;
END;
$$;

-- =============================================================================
-- C) RPC Mesa: asignar sede manual (sin mover cita / cupos / etapa)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_set_notificacion_booking_location(
  p_booking_id UUID,
  p_location_id TEXT
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
  v_booking RECORD;
  v_new_location TEXT;
  v_prev TEXT;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_set_notificacion_booking_location: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_set_notificacion_booking_location: perfil inactivo'
      USING ERRCODE = '42501';
  END IF;

  -- mesa_control_admin es alias UI de mesa_admin
  IF v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_set_notificacion_booking_location: rol no autorizado (%)',
      v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'mesa_set_notificacion_booking_location: booking_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_new_location := public.agenda_notificacion_normalize_location_id(p_location_id);

  SELECT
    b.id,
    b.organization_id,
    b.expediente_id,
    b.kind,
    b.status,
    b.location_id,
    b.booking_date,
    b.booking_time
  INTO v_booking
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_set_notificacion_booking_location: booking no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_booking.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'mesa_set_notificacion_booking_location: fuera de organización'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(v_booking.expediente_id) THEN
    RAISE EXCEPTION 'mesa_set_notificacion_booking_location: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF v_booking.kind IS DISTINCT FROM 'notificacion'::public.booking_kind THEN
    RAISE EXCEPTION 'mesa_set_notificacion_booking_location: solo kind=notificacion'
      USING ERRCODE = '22023';
  END IF;

  v_prev := v_booking.location_id;

  -- Idempotente: ya canónica e igual a la pedida
  IF lower(btrim(coalesce(v_prev, ''))) = v_new_location THEN
    RETURN jsonb_build_object(
      'ok', true,
      'booking_id', v_booking.id,
      'location_id', v_new_location,
      'unchanged', true,
      'booking_date', v_booking.booking_date,
      'booking_time', v_booking.booking_time,
      'status', v_booking.status,
      'kind', v_booking.kind
    );
  END IF;

  IF NOT public.agenda_notificacion_location_needs_assignment(v_prev) THEN
    RAISE EXCEPTION
      'mesa_set_notificacion_booking_location: sede actual ya es canónica (%)',
      v_prev
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_bookings
  SET location_id = v_new_location
  WHERE id = v_booking.id
    AND kind = 'notificacion'::public.booking_kind;

  PERFORM public.log_action(
    v_booking.organization_id,
    v_actor_id,
    v_actor_role,
    'agenda.notificacion.set_location',
    'agenda_booking',
    v_booking.id,
    jsonb_build_object(
      'booking_id', v_booking.id,
      'expediente_id', v_booking.expediente_id,
      'previous_location_id', v_prev,
      'new_location_id', v_new_location,
      'booking_date', v_booking.booking_date,
      'booking_time', v_booking.booking_time,
      'status', v_booking.status,
      'kind', v_booking.kind
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'location_id', v_new_location,
    'previous_location_id', v_prev,
    'unchanged', false,
    'booking_date', v_booking.booking_date,
    'booking_time', v_booking.booking_time,
    'status', v_booking.status,
    'kind', v_booking.kind
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_set_notificacion_booking_location(UUID, TEXT) IS
  'P131: Mesa asigna sede monterrey|apodaca a notificación con location inválida; no mueve fecha/hora/cupo/etapa.';

REVOKE ALL ON FUNCTION public.mesa_set_notificacion_booking_location(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_set_notificacion_booking_location(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_set_notificacion_booking_location(UUID, TEXT) TO authenticated;
