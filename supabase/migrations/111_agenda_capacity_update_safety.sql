-- ConCasa CRM — P125: actualización segura de cupos (sin mover/duplicar citas)
-- - Aumentar cupo: siempre permitido
-- - Reducir: solo si nueva capacidad >= ocupados activos (status=booked)
-- - capacity_by_time recurrente: bloquea si nueva < max ocupados futuros por hora+sede+kind
-- - Locks compartidos org+kind+sede+hora (+ slot por fecha) entre upsert cupo y booking
-- - ON CONFLICT idempotente; no muta bookings ni excepciones históricas

-- =============================================================================
-- Helpers: locks + max ocupados futuros + mensaje canónico
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_advisory_lock_slotcap_hour(
  p_org_id UUID,
  p_kind public.booking_kind,
  p_location_id TEXT,
  p_time_label TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_org_id::TEXT || ':' || p_kind::TEXT || ':slotcap:' ||
      NULLIF(btrim(COALESCE(p_location_id, '')), '') || ':' ||
      NULLIF(btrim(COALESCE(p_time_label, '')), '')
    )
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_advisory_lock_slotcap_hour(UUID, public.booking_kind, TEXT, TEXT) IS
  'P125: lock compartido org+kind+sede+hora entre update de cupo y booking.';

CREATE OR REPLACE FUNCTION public.agenda_advisory_lock_slot_capacity(
  p_org_id UUID,
  p_kind public.booking_kind,
  p_location_id TEXT,
  p_slot_date DATE,
  p_slot_time TIME
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_time_label TEXT;
BEGIN
  v_time_label := to_char(p_slot_time, 'HH24:MI');
  PERFORM public.agenda_advisory_lock_slotcap_hour(p_org_id, p_kind, p_location_id, v_time_label);
  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_org_id::TEXT || ':' || p_kind::TEXT || ':' ||
      p_slot_date::TEXT || ':' || v_time_label || ':' ||
      NULLIF(btrim(COALESCE(p_location_id, '')), '')
    )
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_advisory_lock_slot_capacity(UUID, public.booking_kind, TEXT, DATE, TIME) IS
  'P125: lock hora compartido + lock de slot (fecha) para cupo/booking.';

CREATE OR REPLACE FUNCTION public.agenda_max_future_slot_occupied(
  p_org_id UUID,
  p_kind public.booking_kind,
  p_location_id TEXT,
  p_slot_time TIME
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(cnt), 0)::INTEGER
  FROM (
    SELECT COUNT(*)::INTEGER AS cnt
    FROM public.agenda_bookings b
    WHERE b.organization_id = p_org_id
      AND b.kind = p_kind
      AND b.location_id = p_location_id
      AND b.booking_time = p_slot_time
      AND b.status = 'booked'
      AND (
        b.booking_date > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Monterrey')::DATE
        OR (
          b.booking_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Monterrey')::DATE
          AND b.booking_time >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Monterrey')::TIME
        )
      )
    GROUP BY b.booking_date
  ) s;
$$;

COMMENT ON FUNCTION public.agenda_max_future_slot_occupied(UUID, public.booking_kind, TEXT, TIME) IS
  'P125: máximo de bookings booked futuros por fecha para hora+sede+kind.';

REVOKE ALL ON FUNCTION public.agenda_max_future_slot_occupied(UUID, public.booking_kind, TEXT, TIME) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_max_future_slot_occupied(UUID, public.booking_kind, TEXT, TIME) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.agenda_assert_capacity_gte_occupied(
  p_capacity INTEGER,
  p_occupied INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_capacity IS NULL OR p_capacity < 1 THEN
    RAISE EXCEPTION 'capacidad debe ser > 0' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_occupied, 0) > 0 AND p_capacity < p_occupied THEN
    RAISE EXCEPTION 'No puedes establecer un cupo menor a las % citas ya reservadas.',
      p_occupied
      USING ERRCODE = '22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_assert_capacity_by_time_safe(
  p_org_id UUID,
  p_kind public.booking_kind,
  p_config JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_location_id TEXT;
  v_location_cfg JSONB;
  v_cbt JSONB;
  v_time_label TEXT;
  v_cap INTEGER;
  v_slot_time TIME;
  v_max_occ INTEGER;
BEGIN
  IF p_kind NOT IN ('biometricos', 'firmas') THEN
    RETURN;
  END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config->'locations') <> 'object' THEN
    RETURN;
  END IF;

  FOR v_location_id, v_location_cfg IN
    SELECT key, value FROM jsonb_each(p_config->'locations')
  LOOP
    IF NOT (v_location_cfg ? 'capacity_by_time')
       OR jsonb_typeof(v_location_cfg->'capacity_by_time') <> 'object' THEN
      CONTINUE;
    END IF;
    v_cbt := v_location_cfg->'capacity_by_time';
    FOR v_time_label IN SELECT jsonb_object_keys(v_cbt) LOOP
      BEGIN
        v_cap := (v_cbt->>v_time_label)::INTEGER;
      EXCEPTION WHEN OTHERS THEN
        CONTINUE;
      END;
      IF v_cap IS NULL OR v_cap < 1 THEN
        CONTINUE;
      END IF;
      v_slot_time := v_time_label::TIME;
      PERFORM public.agenda_advisory_lock_slotcap_hour(
        p_org_id, p_kind, v_location_id, v_time_label
      );
      v_max_occ := public.agenda_max_future_slot_occupied(
        p_org_id, p_kind, v_location_id, v_slot_time
      );
      PERFORM public.agenda_assert_capacity_gte_occupied(v_cap, v_max_occ);
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.agenda_assert_capacity_by_time_safe(UUID, public.booking_kind, JSONB) IS
  'P125: bloquea capacity_by_time si queda bajo el máximo de ocupados futuros.';

REVOKE ALL ON FUNCTION public.agenda_assert_capacity_by_time_safe(UUID, public.booking_kind, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_assert_capacity_by_time_safe(UUID, public.booking_kind, JSONB) TO authenticated, service_role;

-- =============================================================================
-- upsert_agenda_slot_capacity: locks + mensaje canónico (sin mutar bookings)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_agenda_slot_capacity(
  p_kind public.booking_kind,
  p_location_id TEXT,
  p_slot_date DATE,
  p_slot_time TIME,
  p_capacity INTEGER,
  p_active BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_org UUID;
  v_loc TEXT;
  v_occupied INTEGER;
  v_id UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_slot_capacity: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor_id AND p.active = true;

  IF NOT FOUND OR v_role NOT IN ('mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'upsert_agenda_slot_capacity: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_slot_capacity: org requerida' USING ERRCODE = '22023';
  END IF;

  IF p_kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'upsert_agenda_slot_capacity: kind no soporta cupos (%)', p_kind
      USING ERRCODE = '22023';
  END IF;

  v_loc := NULLIF(btrim(COALESCE(p_location_id, '')), '');
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_slot_capacity: sede obligatoria' USING ERRCODE = '22023';
  END IF;

  IF p_slot_date IS NULL OR p_slot_time IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_slot_capacity: fecha/hora obligatorias' USING ERRCODE = '22023';
  END IF;

  IF p_capacity IS NULL OR p_capacity < 1 THEN
    RAISE EXCEPTION 'upsert_agenda_slot_capacity: capacidad debe ser > 0' USING ERRCODE = '22023';
  END IF;

  -- P125: serializa con booking (hora + slot fecha) y revalida ocupados
  PERFORM public.agenda_advisory_lock_slot_capacity(
    v_org, p_kind, v_loc, p_slot_date, p_slot_time
  );

  v_occupied := public.agenda_count_slot_booked(v_org, p_kind, p_slot_date, p_slot_time, v_loc);
  PERFORM public.agenda_assert_capacity_gte_occupied(p_capacity, v_occupied);

  INSERT INTO public.agenda_slot_capacities (
    organization_id, kind, location_id, slot_date, slot_time,
    capacity, active, created_by, updated_by
  ) VALUES (
    v_org, p_kind, v_loc, p_slot_date, p_slot_time,
    p_capacity, COALESCE(p_active, true), v_actor_id, v_actor_id
  )
  ON CONFLICT (organization_id, kind, location_id, slot_date, slot_time)
  DO UPDATE SET
    capacity = EXCLUDED.capacity,
    active = EXCLUDED.active,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW()
  RETURNING id INTO v_id;

  PERFORM public.log_action(
    v_org, v_actor_id, v_role,
    'agenda.slot_capacity.upsert',
    'agenda_slot_capacity',
    v_id,
    jsonb_build_object(
      'kind', p_kind,
      'location_id', v_loc,
      'slot_date', p_slot_date,
      'slot_time', p_slot_time,
      'capacity', p_capacity,
      'active', COALESCE(p_active, true),
      'occupied', v_occupied
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'occupied', v_occupied,
    'available', GREATEST(0, p_capacity - v_occupied)
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_agenda_slot_capacity(public.booking_kind, TEXT, DATE, TIME, INTEGER, BOOLEAN) IS
  'P125: cupo por fecha+hora+sede+kind; locks + no baja bajo ocupados; no muta bookings.';


CREATE OR REPLACE FUNCTION public.agenda_biometricos_assert_slot_available(
  p_org_id uuid,
  p_scheduled_at timestamp with time zone,
  p_location_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.agenda_config%ROWTYPE;
  v_config JSONB;
  v_tz TEXT;
  v_local_ts TIMESTAMP;
  v_booking_date DATE;
  v_booking_time TIME;
  v_time_label TEXT;
  v_min_lead_hours INTEGER;
  v_iso_dow INTEGER;
  v_slot TEXT;
  v_slot_allowed BOOLEAN := false;
  v_location_cfg JSONB;
  v_capacity INTEGER;
  v_booked_count INTEGER;
  v_resolved RECORD;
  v_recurrent INTEGER;
BEGIN
  SELECT ac.*
  INTO v_row
  FROM public.agenda_config ac
  WHERE ac.organization_id = p_org_id
    AND ac.kind = 'biometricos';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_config: configuración biométricos no encontrada'
      USING ERRCODE = '22023';
  END IF;

  v_config := public.agenda_biometricos_normalize_config(v_row.config);

  IF COALESCE((v_config->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: agenda biométricos deshabilitada'
      USING ERRCODE = '22023';
  END IF;

  v_tz := NULLIF(btrim(COALESCE(v_config->>'timezone', '')), '');
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'agenda_config: timezone no configurado'
      USING ERRCODE = '22023';
  END IF;

  v_local_ts := p_scheduled_at AT TIME ZONE v_tz;
  v_booking_date := v_local_ts::DATE;
  v_booking_time := v_local_ts::TIME;
  v_time_label := to_char(v_local_ts, 'HH24:MI');

  v_min_lead_hours := public.agenda_biometricos_min_lead_hours(v_config);
  IF p_scheduled_at < NOW() + (v_min_lead_hours || ' hours')::INTERVAL THEN
    RAISE EXCEPTION 'agenda_config: fecha no cumple anticipación mínima'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'allowed_weekdays')
     OR jsonb_typeof(v_config->'allowed_weekdays') <> 'array'
     OR jsonb_array_length(v_config->'allowed_weekdays') = 0 THEN
    RAISE EXCEPTION 'agenda_config: días no configurados'
      USING ERRCODE = '22023';
  END IF;

  v_iso_dow := EXTRACT(ISODOW FROM v_local_ts)::INTEGER;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_config->'allowed_weekdays') elem
    WHERE (elem #>> '{}')::INTEGER = v_iso_dow
  ) THEN
    RAISE EXCEPTION 'agenda_config: día no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF (v_config ? 'slots')
     AND jsonb_typeof(v_config->'slots') = 'array'
     AND jsonb_array_length(v_config->'slots') > 0 THEN
    FOR v_slot IN
      SELECT jsonb_array_elements_text(v_config->'slots')
    LOOP
      IF v_time_label = v_slot THEN
        v_slot_allowed := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- P118: horario explícito en cupos activos también es válido
  IF NOT v_slot_allowed AND EXISTS (
    SELECT 1 FROM public.agenda_slot_capacities c
    WHERE c.organization_id = p_org_id
      AND c.kind = 'biometricos'
      AND c.location_id = p_location_id
      AND c.slot_date = v_booking_date
      AND to_char(c.slot_time, 'HH24:MI') = v_time_label
      AND c.active = true
  ) THEN
    v_slot_allowed := true;
  END IF;

  IF NOT v_slot_allowed THEN
    RAISE EXCEPTION 'agenda_config: horario no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'locations')
     OR jsonb_typeof(v_config->'locations') <> 'object'
     OR v_config->'locations' = '{}'::JSONB THEN
    RAISE EXCEPTION 'agenda_config: sedes no configuradas'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config->'locations' ? p_location_id) THEN
    RAISE EXCEPTION 'agenda_config: sede no permitida'
      USING ERRCODE = '22023';
  END IF;

  v_location_cfg := v_config->'locations'->p_location_id;
  IF COALESCE((v_location_cfg->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: sede deshabilitada'
      USING ERRCODE = '22023';
  END IF;

  -- P124: solo excepción por fecha o capacity_by_time[hora] (sin capacity_per_slot)
  v_recurrent := public.agenda_location_explicit_capacity(v_location_cfg, v_time_label);

  -- P125: lock compartido org+kind+sede+hora + lock de slot (fecha)
  PERFORM public.agenda_advisory_lock_slot_capacity(
    p_org_id, 'biometricos'::public.booking_kind, p_location_id, v_booking_date, v_booking_time
  );

  SELECT * INTO v_resolved
  FROM public.agenda_resolve_slot_capacity(
    p_org_id, 'biometricos'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id,
    GREATEST(1, COALESCE(v_recurrent, 1))
  );

  IF v_resolved.active IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: horario desactivado'
      USING ERRCODE = '22023';
  END IF;

  IF v_resolved.from_override THEN
    v_capacity := GREATEST(1, v_resolved.capacity);
  ELSIF v_recurrent IS NOT NULL THEN
    v_capacity := GREATEST(1, v_recurrent);
  ELSE
    RAISE EXCEPTION 'agenda_config: cupo no configurado para horario'
      USING ERRCODE = '22023';
  END IF;

  v_booked_count := public.agenda_count_slot_booked(
    p_org_id, 'biometricos'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id
  );

  IF v_booked_count >= v_capacity THEN
    RAISE EXCEPTION 'agenda_config: cupo agotado'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'agenda_config_applied', true,
    'timezone', v_tz,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', p_location_id,
    'capacity_per_slot', v_capacity,
    'booked_count_before', v_booked_count,
    'capacity_from_override', v_resolved.from_override
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_firmas_assert_slot_available(
  p_org_id uuid,
  p_scheduled_at timestamp with time zone,
  p_location_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.agenda_config%ROWTYPE;
  v_config JSONB;
  v_tz TEXT;
  v_local_ts TIMESTAMP;
  v_booking_date DATE;
  v_booking_time TIME;
  v_time_label TEXT;
  v_min_lead_hours INTEGER;
  v_iso_dow INTEGER;
  v_slot TEXT;
  v_slot_allowed BOOLEAN := false;
  v_location_cfg JSONB;
  v_capacity INTEGER;
  v_booked_count INTEGER;
  v_resolved RECORD;
  v_recurrent INTEGER;
BEGIN
  SELECT ac.*
  INTO v_row
  FROM public.agenda_config ac
  WHERE ac.organization_id = p_org_id
    AND ac.kind = 'firmas';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_config: configuración firmas no encontrada'
      USING ERRCODE = '22023';
  END IF;

  v_config := public.agenda_firmas_normalize_config(v_row.config);

  IF COALESCE((v_config->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: agenda firmas deshabilitada'
      USING ERRCODE = '22023';
  END IF;

  v_tz := NULLIF(btrim(COALESCE(v_config->>'timezone', '')), '');
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'agenda_config: timezone no configurado'
      USING ERRCODE = '22023';
  END IF;

  v_local_ts := p_scheduled_at AT TIME ZONE v_tz;
  v_booking_date := v_local_ts::DATE;
  v_booking_time := v_local_ts::TIME;
  v_time_label := to_char(v_local_ts, 'HH24:MI');

  v_min_lead_hours := public.agenda_firmas_min_lead_hours(v_config);
  IF p_scheduled_at < NOW() + (v_min_lead_hours || ' hours')::INTERVAL THEN
    RAISE EXCEPTION 'agenda_config: fecha no cumple anticipación mínima'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'allowed_weekdays')
     OR jsonb_typeof(v_config->'allowed_weekdays') <> 'array'
     OR jsonb_array_length(v_config->'allowed_weekdays') = 0 THEN
    RAISE EXCEPTION 'agenda_config: días no configurados'
      USING ERRCODE = '22023';
  END IF;

  v_iso_dow := EXTRACT(ISODOW FROM v_local_ts)::INTEGER;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_config->'allowed_weekdays') elem
    WHERE (elem #>> '{}')::INTEGER = v_iso_dow
  ) THEN
    RAISE EXCEPTION 'agenda_config: día no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF (v_config ? 'slots')
     AND jsonb_typeof(v_config->'slots') = 'array'
     AND jsonb_array_length(v_config->'slots') > 0 THEN
    FOR v_slot IN
      SELECT jsonb_array_elements_text(v_config->'slots')
    LOOP
      IF v_time_label = v_slot THEN
        v_slot_allowed := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF NOT v_slot_allowed AND EXISTS (
    SELECT 1 FROM public.agenda_slot_capacities c
    WHERE c.organization_id = p_org_id
      AND c.kind = 'firmas'
      AND c.location_id = p_location_id
      AND c.slot_date = v_booking_date
      AND to_char(c.slot_time, 'HH24:MI') = v_time_label
      AND c.active = true
  ) THEN
    v_slot_allowed := true;
  END IF;

  IF NOT v_slot_allowed THEN
    RAISE EXCEPTION 'agenda_config: horario no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'locations')
     OR jsonb_typeof(v_config->'locations') <> 'object'
     OR v_config->'locations' = '{}'::JSONB THEN
    RAISE EXCEPTION 'agenda_config: sedes no configuradas'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config->'locations' ? p_location_id) THEN
    RAISE EXCEPTION 'agenda_config: sede no permitida'
      USING ERRCODE = '22023';
  END IF;

  v_location_cfg := v_config->'locations'->p_location_id;
  IF COALESCE((v_location_cfg->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: sede deshabilitada'
      USING ERRCODE = '22023';
  END IF;

  -- P124: solo excepción por fecha o capacity_by_time[hora] (sin capacity_per_slot)
  v_recurrent := public.agenda_location_explicit_capacity(v_location_cfg, v_time_label);

  -- P125: lock compartido org+kind+sede+hora + lock de slot (fecha)
  PERFORM public.agenda_advisory_lock_slot_capacity(
    p_org_id, 'firmas'::public.booking_kind, p_location_id, v_booking_date, v_booking_time
  );

  SELECT * INTO v_resolved
  FROM public.agenda_resolve_slot_capacity(
    p_org_id, 'firmas'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id,
    GREATEST(1, COALESCE(v_recurrent, 1))
  );

  IF v_resolved.active IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: horario desactivado'
      USING ERRCODE = '22023';
  END IF;

  IF v_resolved.from_override THEN
    v_capacity := GREATEST(1, v_resolved.capacity);
  ELSIF v_recurrent IS NOT NULL THEN
    v_capacity := GREATEST(1, v_recurrent);
  ELSE
    RAISE EXCEPTION 'agenda_config: cupo no configurado para horario'
      USING ERRCODE = '22023';
  END IF;

  v_booked_count := public.agenda_count_slot_booked(
    p_org_id, 'firmas'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id
  );

  IF v_booked_count >= v_capacity THEN
    RAISE EXCEPTION 'agenda_config: cupo firmas agotado'
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'agenda_config_applied', true,
    'timezone', v_tz,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', p_location_id,
    'capacity_per_slot', v_capacity,
    'booked_count_before', v_booked_count,
    'capacity_from_override', v_resolved.from_override
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.upsert_agenda_config_biometricos(
  p_config JSONB,
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_target_org UUID;
  v_validated JSONB;
  v_normalized JSONB;
  v_row public.agenda_config%ROWTYPE;
  v_created BOOLEAN;
  v_existed_before BOOLEAN;
  v_warnings JSONB;
  v_location_ids JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL THEN
    v_target_org := v_actor_org;
  ELSIF v_actor_role = 'super_admin' THEN
    v_target_org := p_organization_id;
  ELSIF p_organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: mesa_admin no puede configurar otra organización'
      USING ERRCODE = '42501';
  ELSE
    v_target_org := v_actor_org;
  END IF;

  IF v_target_org IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: organization_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = v_target_org
      AND o.active = true
  ) THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: organización no encontrada o inactiva'
      USING ERRCODE = 'P0002';
  END IF;

  v_validated := public.agenda_biometricos_validate_config(p_config);
  v_normalized := public.agenda_biometricos_normalize_config(v_validated);
  -- P125: no reducir capacity_by_time bajo max ocupados futuros
  PERFORM public.agenda_assert_capacity_by_time_safe(
    v_target_org, 'biometricos'::public.booking_kind, v_normalized
  );

  v_warnings := public.agenda_biometricos_config_upsert_warnings(v_target_org, v_normalized);

  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_config ac
    WHERE ac.organization_id = v_target_org
      AND ac.kind = 'biometricos'
  ) INTO v_existed_before;

  INSERT INTO public.agenda_config (
    organization_id,
    kind,
    config,
    updated_by
  ) VALUES (
    v_target_org,
    'biometricos',
    v_normalized,
    v_actor_id
  )
  ON CONFLICT (organization_id, kind) DO UPDATE SET
    config = EXCLUDED.config,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW()
  RETURNING * INTO v_row;

  v_created := NOT v_existed_before;

  SELECT COALESCE(jsonb_agg(key ORDER BY key), '[]'::JSONB)
  INTO v_location_ids
  FROM jsonb_object_keys(v_normalized->'locations') AS key;

  PERFORM public.log_action(
    v_target_org,
    v_actor_id,
    v_actor_role,
    'agenda.biometricos.config_upsert',
    'agenda_config',
    v_row.id,
    jsonb_build_object(
      'organization_id', v_target_org,
      'kind', 'biometricos',
      'created', v_created,
      'enabled', v_normalized->'enabled',
      'timezone', v_normalized->'timezone',
      'min_lead_hours', v_normalized->'min_lead_hours',
      'slots_count', jsonb_array_length(v_normalized->'slots'),
      'location_ids', v_location_ids,
      'warnings_count', jsonb_array_length(v_warnings),
      'config_hash', md5(v_normalized::TEXT)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'agenda_config_id', v_row.id,
    'organization_id', v_target_org,
    'kind', 'biometricos',
    'config', v_normalized,
    'created', v_created,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by,
    'warnings', v_warnings
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.upsert_agenda_config_firmas(
  p_config JSONB,
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_target_org UUID;
  v_preprocessed JSONB;
  v_validated JSONB;
  v_normalized JSONB;
  v_row public.agenda_config%ROWTYPE;
  v_created BOOLEAN;
  v_existed_before BOOLEAN;
  v_warnings JSONB;
  v_location_ids JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'super_admin') THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_organization_id IS NULL THEN
    v_target_org := v_actor_org;
  ELSIF v_actor_role = 'super_admin' THEN
    v_target_org := p_organization_id;
  ELSIF p_organization_id IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: mesa_admin no puede configurar otra organización'
      USING ERRCODE = '42501';
  ELSE
    v_target_org := v_actor_org;
  END IF;

  IF v_target_org IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: organization_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = v_target_org
      AND o.active = true
  ) THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: organización no encontrada o inactiva'
      USING ERRCODE = 'P0002';
  END IF;

  v_preprocessed := public.agenda_firmas_normalize_config(COALESCE(p_config, '{}'::jsonb));
  v_validated := public.agenda_firmas_validate_config(v_preprocessed);
  v_normalized := public.agenda_firmas_normalize_config(v_validated);
  -- P125: no reducir capacity_by_time bajo max ocupados futuros
  PERFORM public.agenda_assert_capacity_by_time_safe(
    v_target_org, 'firmas'::public.booking_kind, v_normalized
  );

  v_warnings := public.agenda_firmas_config_upsert_warnings(v_target_org, v_normalized);

  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_config ac
    WHERE ac.organization_id = v_target_org
      AND ac.kind = 'firmas'
  ) INTO v_existed_before;

  INSERT INTO public.agenda_config (
    organization_id,
    kind,
    config,
    updated_by
  ) VALUES (
    v_target_org,
    'firmas',
    v_normalized,
    v_actor_id
  )
  ON CONFLICT (organization_id, kind) DO UPDATE SET
    config = EXCLUDED.config,
    updated_by = EXCLUDED.updated_by,
    updated_at = NOW()
  RETURNING * INTO v_row;

  v_created := NOT v_existed_before;

  SELECT COALESCE(jsonb_agg(key ORDER BY key), '[]'::JSONB)
  INTO v_location_ids
  FROM jsonb_object_keys(v_normalized->'locations') AS key;

  PERFORM public.log_action(
    v_target_org,
    v_actor_id,
    v_actor_role,
    'agenda.firmas.config_upsert',
    'agenda_config',
    v_row.id,
    jsonb_build_object(
      'organization_id', v_target_org,
      'kind', 'firmas',
      'created', v_created,
      'enabled', v_normalized->'enabled',
      'timezone', v_normalized->'timezone',
      'min_lead_hours', v_normalized->'min_lead_hours',
      'slots_count', jsonb_array_length(v_normalized->'slots'),
      'location_ids', v_location_ids,
      'warnings_count', jsonb_array_length(v_warnings),
      'config_hash', md5(v_normalized::TEXT)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'agenda_config_id', v_row.id,
    'organization_id', v_target_org,
    'kind', 'firmas',
    'config', v_normalized,
    'created', v_created,
    'updated_at', v_row.updated_at,
    'updated_by', v_row.updated_by,
    'warnings', v_warnings
  );
END;
$$;



COMMENT ON FUNCTION public.agenda_biometricos_assert_slot_available(uuid, timestamp with time zone, text) IS
  'Assert biométricos P125: locks compartidos + override fecha → capacity_by_time.';
COMMENT ON FUNCTION public.agenda_firmas_assert_slot_available(uuid, timestamp with time zone, text) IS
  'Assert firmas P125: locks compartidos + override fecha → capacity_by_time.';
COMMENT ON FUNCTION public.upsert_agenda_config_biometricos(JSONB, UUID) IS
  'Mesa admin / super_admin: upsert agenda_config biométricos; P125 bloquea capacity_by_time bajo ocupados futuros.';
COMMENT ON FUNCTION public.upsert_agenda_config_firmas(JSONB, UUID) IS
  'Mesa admin / super_admin: upsert agenda_config firmas; P125 bloquea capacity_by_time bajo ocupados futuros.';
