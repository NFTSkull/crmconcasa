-- ConCasa CRM — P126: permitir capacity_by_time = 0 (cierre por sede/horario)
-- - vacío / sin clave = falta configuración
-- - 0 = cerrado para nuevas reservas (sin fallback capacity_per_slot)
-- - >= 1 = cupo normal
-- Conserva bookings existentes; no muta agenda_bookings.
-- Excepciones por fecha (agenda_slot_capacities) siguen exigiendo capacidad > 0.

-- =============================================================================
-- Helper: capacity_by_time explícito (incluye 0)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_location_explicit_capacity(
  p_location_cfg JSONB,
  p_time_label TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cap INTEGER;
  v_time TEXT := NULLIF(btrim(COALESCE(p_time_label, '')), '');
BEGIN
  IF p_location_cfg IS NULL OR v_time IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (p_location_cfg ? 'capacity_by_time')
     OR jsonb_typeof(p_location_cfg->'capacity_by_time') <> 'object'
     OR NOT (p_location_cfg->'capacity_by_time' ? v_time) THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_cap := (p_location_cfg->'capacity_by_time'->>v_time)::INTEGER;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN NULL;
  END;
  -- P126: 0 es cierre explícito; negativo / null → ausente
  IF v_cap IS NULL OR v_cap < 0 THEN
    RETURN NULL;
  END IF;
  RETURN v_cap;
END;
$$;

COMMENT ON FUNCTION public.agenda_location_explicit_capacity(JSONB, TEXT) IS
  'P126: cupo explícito capacity_by_time[hora]; 0=cierre; NULL si no existe (sin fallback).';

CREATE OR REPLACE FUNCTION public.agenda_location_fallback_capacity(
  p_location_cfg JSONB,
  p_time_label TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN public.agenda_location_explicit_capacity(p_location_cfg, p_time_label);
END;
$$;

-- Resolver: permitir fallback 0 (cierre) sin convertirlo a 1
CREATE OR REPLACE FUNCTION public.agenda_resolve_slot_capacity(
  p_org_id UUID,
  p_kind public.booking_kind,
  p_slot_date DATE,
  p_slot_time TIME,
  p_location_id TEXT,
  p_fallback_capacity INTEGER
)
RETURNS TABLE (
  capacity INTEGER,
  from_override BOOLEAN,
  active BOOLEAN,
  capacity_row_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.agenda_slot_capacities%ROWTYPE;
  v_fallback INTEGER;
BEGIN
  -- P126: NULL → 1 (compat); 0 se conserva como cierre
  v_fallback := CASE
    WHEN p_fallback_capacity IS NULL THEN 1
    WHEN p_fallback_capacity < 0 THEN 1
    ELSE p_fallback_capacity
  END;

  SELECT c.*
  INTO v_row
  FROM public.agenda_slot_capacities c
  WHERE c.organization_id = p_org_id
    AND c.kind = p_kind
    AND c.location_id = p_location_id
    AND c.slot_date = p_slot_date
    AND c.slot_time = p_slot_time
  FOR UPDATE;

  IF FOUND THEN
    capacity := v_row.capacity;
    from_override := true;
    active := v_row.active;
    capacity_row_id := v_row.id;
    RETURN NEXT;
    RETURN;
  END IF;

  capacity := v_fallback;
  from_override := false;
  active := true;
  capacity_row_id := NULL;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.agenda_resolve_slot_capacity(UUID, public.booking_kind, DATE, TIME, TEXT, INTEGER) IS
  'P118/P126: override por fecha o fallback (0=cierre explícito recurrente).';

-- Assert recurrente: 0 permitido como cierre (no exige >= ocupados)
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
      -- P126: 0 = cierre explícito (conserva citas); no aplica regla ocupados
      IF v_cap IS NULL OR v_cap < 0 THEN
        CONTINUE;
      END IF;
      IF v_cap = 0 THEN
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
  'P125/P126: bloquea capacity_by_time>0 bajo ocupados; 0=cierre permitido.';


-- =============================================================================
-- Validate: capacity_by_time >= 0
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_biometricos_validate_config(p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_key TEXT;
  v_enabled BOOLEAN;
  v_timezone TEXT;
  v_min_lead_hours INTEGER;
  v_weekday INTEGER;
  v_weekdays JSONB;
  v_seen_weekdays INTEGER[] := ARRAY[]::INTEGER[];
  v_slot TEXT;
  v_slots JSONB;
  v_seen_slots TEXT[] := ARRAY[]::TEXT[];
  v_locations JSONB;
  v_location_id TEXT;
  v_location_cfg JSONB;
  v_loc_key TEXT;
  v_capacity INTEGER;
  v_cbt_key TEXT;
  v_cbt_cap INTEGER;
  v_has_enabled_location BOOLEAN := false;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: config debe ser un objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_config) LOOP
    IF v_key NOT IN ('enabled', 'timezone', 'min_lead_hours', 'allowed_weekdays', 'slots', 'locations') THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: clave no permitida en config: %', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF NOT (p_config ? 'enabled') OR jsonb_typeof(p_config->'enabled') <> 'boolean' THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: enabled debe ser boolean'
      USING ERRCODE = '22023';
  END IF;
  v_enabled := (p_config->>'enabled')::BOOLEAN;

  IF NOT (p_config ? 'timezone')
     OR jsonb_typeof(p_config->'timezone') <> 'string'
     OR NULLIF(btrim(p_config->>'timezone'), '') IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: timezone es obligatorio'
      USING ERRCODE = '22023';
  END IF;
  v_timezone := btrim(p_config->>'timezone');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_timezone) THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: timezone inválido: %', v_timezone
      USING ERRCODE = '22023';
  END IF;

  IF NOT (p_config ? 'min_lead_hours')
     OR jsonb_typeof(p_config->'min_lead_hours') NOT IN ('number', 'string') THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: min_lead_hours es obligatorio'
      USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_min_lead_hours := (p_config->>'min_lead_hours')::INTEGER;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: min_lead_hours debe ser entero'
        USING ERRCODE = '22023';
  END;
  IF v_min_lead_hours < 0 THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: min_lead_hours debe ser >= 0'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (p_config ? 'allowed_weekdays')
     OR jsonb_typeof(p_config->'allowed_weekdays') <> 'array'
     OR jsonb_array_length(p_config->'allowed_weekdays') = 0 THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: allowed_weekdays no puede estar vacío'
      USING ERRCODE = '22023';
  END IF;
  v_weekdays := p_config->'allowed_weekdays';
  FOR v_weekday IN
    SELECT (elem #>> '{}')::INTEGER
    FROM jsonb_array_elements(v_weekdays) elem
  LOOP
    IF v_weekday < 1 OR v_weekday > 7 THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: allowed_weekdays fuera de rango 1-7'
        USING ERRCODE = '22023';
    END IF;
    IF v_weekday = ANY (v_seen_weekdays) THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: allowed_weekdays con duplicados'
        USING ERRCODE = '22023';
    END IF;
    v_seen_weekdays := array_append(v_seen_weekdays, v_weekday);
  END LOOP;

  IF NOT (p_config ? 'slots')
     OR jsonb_typeof(p_config->'slots') <> 'array'
     OR jsonb_array_length(p_config->'slots') = 0 THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: slots no puede estar vacío'
      USING ERRCODE = '22023';
  END IF;
  v_slots := p_config->'slots';
  FOR v_slot IN SELECT jsonb_array_elements_text(v_slots) LOOP
    IF v_slot !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: slot inválido: %', v_slot
        USING ERRCODE = '22023';
    END IF;
    IF v_slot = ANY (v_seen_slots) THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: slots con duplicados'
        USING ERRCODE = '22023';
    END IF;
    v_seen_slots := array_append(v_seen_slots, v_slot);
  END LOOP;

  IF NOT (p_config ? 'locations') OR jsonb_typeof(p_config->'locations') <> 'object' THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: locations debe ser un objeto'
      USING ERRCODE = '22023';
  END IF;
  v_locations := p_config->'locations';

  IF v_enabled AND (v_locations = '{}'::JSONB OR v_locations IS NULL) THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: locations no puede estar vacío si enabled=true'
      USING ERRCODE = '22023';
  END IF;

  FOR v_location_id, v_location_cfg IN
    SELECT key, value FROM jsonb_each(v_locations)
  LOOP
    IF v_location_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: location_id inválido: %', v_location_id
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_location_cfg) <> 'object' THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: location debe ser objeto: %', v_location_id
        USING ERRCODE = '22023';
    END IF;
    FOR v_loc_key IN SELECT jsonb_object_keys(v_location_cfg) LOOP
      IF v_loc_key NOT IN ('enabled', 'capacity_per_slot', 'label', 'capacity_by_time') THEN
        RAISE EXCEPTION 'upsert_agenda_config_biometricos: clave no permitida en location %: %',
          v_location_id, v_loc_key
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF NOT (v_location_cfg ? 'enabled') OR jsonb_typeof(v_location_cfg->'enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: location.enabled debe ser boolean (%)', v_location_id
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_location_cfg ? 'capacity_per_slot')
       OR jsonb_typeof(v_location_cfg->'capacity_per_slot') NOT IN ('number', 'string') THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: capacity_per_slot es obligatorio (%)', v_location_id
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_capacity := (v_location_cfg->>'capacity_per_slot')::INTEGER;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'upsert_agenda_config_biometricos: capacity_per_slot debe ser entero (%)', v_location_id
          USING ERRCODE = '22023';
    END;
    IF v_capacity < 1 THEN
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: capacity_per_slot debe ser >= 0 (%)', v_location_id
        USING ERRCODE = '22023';
    END IF;
    IF (v_location_cfg ? 'capacity_by_time') THEN
      IF jsonb_typeof(v_location_cfg->'capacity_by_time') <> 'object' THEN
        RAISE EXCEPTION 'upsert_agenda_config_biometricos: capacity_by_time debe ser objeto (%)',
          v_location_id
          USING ERRCODE = '22023';
      END IF;
      FOR v_cbt_key IN SELECT jsonb_object_keys(v_location_cfg->'capacity_by_time') LOOP
        IF v_cbt_key !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
          RAISE EXCEPTION 'upsert_agenda_config_biometricos: capacity_by_time clave inválida % (%)',
            v_cbt_key, v_location_id
            USING ERRCODE = '22023';
        END IF;
        BEGIN
          v_cbt_cap := (v_location_cfg->'capacity_by_time'->>v_cbt_key)::INTEGER;
        EXCEPTION
          WHEN OTHERS THEN
            RAISE EXCEPTION 'upsert_agenda_config_biometricos: capacity_by_time[%] debe ser entero (%)',
              v_cbt_key, v_location_id
              USING ERRCODE = '22023';
        END;
        IF v_cbt_cap < 0 THEN
          RAISE EXCEPTION 'upsert_agenda_config_biometricos: capacity_by_time[%] debe ser >= 0 (%)',
            v_cbt_key, v_location_id
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    IF (v_location_cfg->>'enabled')::BOOLEAN THEN
      v_has_enabled_location := true;
    END IF;
  END LOOP;

  IF v_enabled AND NOT v_has_enabled_location THEN
    RAISE EXCEPTION 'upsert_agenda_config_biometricos: al menos una sede debe estar enabled=true'
      USING ERRCODE = '22023';
  END IF;

  RETURN p_config;
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_firmas_validate_config(p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_key TEXT;
  v_enabled BOOLEAN;
  v_timezone TEXT;
  v_min_lead_hours INTEGER;
  v_weekday INTEGER;
  v_weekdays JSONB;
  v_seen_weekdays INTEGER[] := ARRAY[]::INTEGER[];
  v_slot TEXT;
  v_slots JSONB;
  v_seen_slots TEXT[] := ARRAY[]::TEXT[];
  v_locations JSONB;
  v_location_id TEXT;
  v_location_cfg JSONB;
  v_loc_key TEXT;
  v_capacity INTEGER;
  v_cbt_key TEXT;
  v_cbt_cap INTEGER;
  v_has_enabled_location BOOLEAN := false;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: config debe ser un objeto JSON'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_config) LOOP
    IF v_key NOT IN ('enabled', 'timezone', 'min_lead_hours', 'allowed_weekdays', 'slots', 'locations') THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: clave no permitida en config: %', v_key
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF NOT (p_config ? 'enabled') OR jsonb_typeof(p_config->'enabled') <> 'boolean' THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: enabled debe ser boolean'
      USING ERRCODE = '22023';
  END IF;
  v_enabled := (p_config->>'enabled')::BOOLEAN;

  IF NOT (p_config ? 'timezone')
     OR jsonb_typeof(p_config->'timezone') <> 'string'
     OR NULLIF(btrim(p_config->>'timezone'), '') IS NULL THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: timezone es obligatorio'
      USING ERRCODE = '22023';
  END IF;
  v_timezone := btrim(p_config->>'timezone');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_timezone) THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: timezone inválido: %', v_timezone
      USING ERRCODE = '22023';
  END IF;

  IF NOT (p_config ? 'min_lead_hours')
     OR jsonb_typeof(p_config->'min_lead_hours') NOT IN ('number', 'string') THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: min_lead_hours es obligatorio'
      USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_min_lead_hours := (p_config->>'min_lead_hours')::INTEGER;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: min_lead_hours debe ser entero'
        USING ERRCODE = '22023';
  END;
  IF v_min_lead_hours < 0 THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: min_lead_hours debe ser >= 0'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (p_config ? 'allowed_weekdays')
     OR jsonb_typeof(p_config->'allowed_weekdays') <> 'array'
     OR jsonb_array_length(p_config->'allowed_weekdays') = 0 THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: allowed_weekdays no puede estar vacío'
      USING ERRCODE = '22023';
  END IF;
  v_weekdays := p_config->'allowed_weekdays';
  FOR v_weekday IN
    SELECT (elem #>> '{}')::INTEGER
    FROM jsonb_array_elements(v_weekdays) elem
  LOOP
    IF v_weekday < 1 OR v_weekday > 7 THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: allowed_weekdays fuera de rango 1-7'
        USING ERRCODE = '22023';
    END IF;
    IF v_weekday = ANY (v_seen_weekdays) THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: allowed_weekdays con duplicados'
        USING ERRCODE = '22023';
    END IF;
    v_seen_weekdays := array_append(v_seen_weekdays, v_weekday);
  END LOOP;

  IF NOT (p_config ? 'slots')
     OR jsonb_typeof(p_config->'slots') <> 'array'
     OR jsonb_array_length(p_config->'slots') = 0 THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: slots no puede estar vacío'
      USING ERRCODE = '22023';
  END IF;
  v_slots := p_config->'slots';
  FOR v_slot IN SELECT jsonb_array_elements_text(v_slots) LOOP
    IF v_slot !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: slot inválido: %', v_slot
        USING ERRCODE = '22023';
    END IF;
    IF v_slot = ANY (v_seen_slots) THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: slots con duplicados'
        USING ERRCODE = '22023';
    END IF;
    v_seen_slots := array_append(v_seen_slots, v_slot);
  END LOOP;

  IF NOT (p_config ? 'locations') OR jsonb_typeof(p_config->'locations') <> 'object' THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: locations debe ser un objeto'
      USING ERRCODE = '22023';
  END IF;
  v_locations := p_config->'locations';

  IF v_enabled AND (v_locations = '{}'::JSONB OR v_locations IS NULL) THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: locations no puede estar vacío si enabled=true'
      USING ERRCODE = '22023';
  END IF;

  FOR v_location_id, v_location_cfg IN
    SELECT key, value FROM jsonb_each(v_locations)
  LOOP
    IF v_location_id !~ '^[a-z0-9][a-z0-9_-]{0,63}$' THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: location_id inválido: %', v_location_id
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_location_cfg) <> 'object' THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: location debe ser objeto: %', v_location_id
        USING ERRCODE = '22023';
    END IF;
    FOR v_loc_key IN SELECT jsonb_object_keys(v_location_cfg) LOOP
      IF v_loc_key NOT IN ('enabled', 'capacity_per_slot', 'label', 'capacity_by_time') THEN
        RAISE EXCEPTION 'upsert_agenda_config_firmas: clave no permitida en location %: %',
          v_location_id, v_loc_key
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF NOT (v_location_cfg ? 'enabled') OR jsonb_typeof(v_location_cfg->'enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: location.enabled debe ser boolean (%)', v_location_id
        USING ERRCODE = '22023';
    END IF;
    IF NOT (v_location_cfg ? 'capacity_per_slot')
       OR jsonb_typeof(v_location_cfg->'capacity_per_slot') NOT IN ('number', 'string') THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: capacity_per_slot es obligatorio (%)', v_location_id
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_capacity := (v_location_cfg->>'capacity_per_slot')::INTEGER;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'upsert_agenda_config_firmas: capacity_per_slot debe ser entero (%)', v_location_id
          USING ERRCODE = '22023';
    END;
    IF v_capacity < 1 THEN
      RAISE EXCEPTION 'upsert_agenda_config_firmas: capacity_per_slot debe ser >= 0 (%)', v_location_id
        USING ERRCODE = '22023';
    END IF;
    IF (v_location_cfg ? 'capacity_by_time') THEN
      IF jsonb_typeof(v_location_cfg->'capacity_by_time') <> 'object' THEN
        RAISE EXCEPTION 'upsert_agenda_config_firmas: capacity_by_time debe ser objeto (%)',
          v_location_id
          USING ERRCODE = '22023';
      END IF;
      FOR v_cbt_key IN SELECT jsonb_object_keys(v_location_cfg->'capacity_by_time') LOOP
        IF v_cbt_key !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
          RAISE EXCEPTION 'upsert_agenda_config_firmas: capacity_by_time clave inválida % (%)',
            v_cbt_key, v_location_id
            USING ERRCODE = '22023';
        END IF;
        BEGIN
          v_cbt_cap := (v_location_cfg->'capacity_by_time'->>v_cbt_key)::INTEGER;
        EXCEPTION
          WHEN OTHERS THEN
            RAISE EXCEPTION 'upsert_agenda_config_firmas: capacity_by_time[%] debe ser entero (%)',
              v_cbt_key, v_location_id
              USING ERRCODE = '22023';
        END;
        IF v_cbt_cap < 0 THEN
          RAISE EXCEPTION 'upsert_agenda_config_firmas: capacity_by_time[%] debe ser >= 0 (%)',
            v_cbt_key, v_location_id
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    IF (v_location_cfg->>'enabled')::BOOLEAN THEN
      v_has_enabled_location := true;
    END IF;
  END LOOP;

  IF v_enabled AND NOT v_has_enabled_location THEN
    RAISE EXCEPTION 'upsert_agenda_config_firmas: al menos una sede debe estar enabled=true'
      USING ERRCODE = '22023';
  END IF;

  RETURN p_config;
END;
$$;

-- =============================================================================
-- Asserts booking: 0 bloquea nuevas reservas
-- =============================================================================
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

  -- P126: capacity_by_time=0 es cierre explícito (sin fallback)
  SELECT * INTO v_resolved
  FROM public.agenda_resolve_slot_capacity(
    p_org_id, 'biometricos'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id,
    CASE WHEN v_recurrent IS NULL THEN 1 ELSE GREATEST(0, v_recurrent) END
  );

  IF v_resolved.active IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: horario desactivado'
      USING ERRCODE = '22023';
  END IF;

  IF v_resolved.from_override THEN
    v_capacity := GREATEST(1, v_resolved.capacity);
  ELSIF v_recurrent IS NOT NULL THEN
    v_capacity := GREATEST(0, v_recurrent);
  ELSE
    RAISE EXCEPTION 'agenda_config: cupo no configurado para horario'
      USING ERRCODE = '22023';
  END IF;

  IF v_capacity < 1 THEN
    RAISE EXCEPTION 'agenda_config: cupo agotado'
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

  -- P126: capacity_by_time=0 es cierre explícito (sin fallback)
  SELECT * INTO v_resolved
  FROM public.agenda_resolve_slot_capacity(
    p_org_id, 'firmas'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id,
    CASE WHEN v_recurrent IS NULL THEN 1 ELSE GREATEST(0, v_recurrent) END
  );

  IF v_resolved.active IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: horario desactivado'
      USING ERRCODE = '22023';
  END IF;

  IF v_resolved.from_override THEN
    v_capacity := GREATEST(1, v_resolved.capacity);
  ELSIF v_recurrent IS NOT NULL THEN
    v_capacity := GREATEST(0, v_recurrent);
  ELSE
    RAISE EXCEPTION 'agenda_config: cupo no configurado para horario'
      USING ERRCODE = '22023';
  END IF;

  IF v_capacity < 1 THEN
    RAISE EXCEPTION 'agenda_config: cupo firmas agotado'
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
  'Assert biométricos P126: override fecha → capacity_by_time (0=cierre); sin capacity_per_slot.';
COMMENT ON FUNCTION public.agenda_firmas_assert_slot_available(uuid, timestamp with time zone, text) IS
  'Assert firmas P126: override fecha → capacity_by_time (0=cierre); sin capacity_per_slot.';

-- =============================================================================
-- Avisos P126: cierre a 0 con citas existentes
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_capacity_zero_closure_warnings(
  p_org_id UUID,
  p_kind public.booking_kind,
  p_config JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  v_now_local TIMESTAMP;
  v_location_id TEXT;
  v_location_cfg JSONB;
  v_cbt JSONB;
  v_time_label TEXT;
  v_cap INTEGER;
  v_slot_time TIME;
  v_count INTEGER;
  v_warnings JSONB := '[]'::JSONB;
  v_seen TEXT[] := ARRAY[]::TEXT[];
  v_key TEXT;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config->'locations') <> 'object' THEN
    RETURN v_warnings;
  END IF;
  v_tz := NULLIF(btrim(COALESCE(p_config->>'timezone', 'America/Monterrey')), '');
  IF v_tz IS NULL THEN
    v_tz := 'America/Monterrey';
  END IF;
  v_now_local := NOW() AT TIME ZONE v_tz;

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
      IF v_cap IS DISTINCT FROM 0 THEN
        CONTINUE;
      END IF;
      v_slot_time := v_time_label::TIME;
      SELECT COUNT(*)::INTEGER INTO v_count
      FROM public.agenda_bookings b
      WHERE b.organization_id = p_org_id
        AND b.kind = p_kind
        AND b.location_id = v_location_id
        AND b.booking_time = v_slot_time
        AND b.status = 'booked'
        AND (
          b.booking_date > v_now_local::DATE
          OR (b.booking_date = v_now_local::DATE AND b.booking_time >= v_now_local::TIME)
        );
      IF COALESCE(v_count, 0) < 1 THEN
        CONTINUE;
      END IF;
      v_key := v_location_id || '|' || v_time_label || '|' || v_count::TEXT;
      IF v_key = ANY (v_seen) THEN
        CONTINUE;
      END IF;
      v_seen := array_append(v_seen, v_key);
      v_warnings := v_warnings || jsonb_build_array(
        format(
          'Este horario dejará de aceptar nuevas citas. Las %s citas existentes se conservarán.',
          v_count
        )
      );
    END LOOP;
  END LOOP;

  RETURN v_warnings;
END;
$$;

COMMENT ON FUNCTION public.agenda_capacity_zero_closure_warnings(UUID, public.booking_kind, JSONB) IS
  'P126: avisos no bloqueantes al cerrar capacity_by_time=0 con bookings activos.';

REVOKE ALL ON FUNCTION public.agenda_capacity_zero_closure_warnings(UUID, public.booking_kind, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_capacity_zero_closure_warnings(UUID, public.booking_kind, JSONB) TO authenticated, service_role;

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
  v_warnings := COALESCE(v_warnings, '[]'::JSONB) ||
    public.agenda_capacity_zero_closure_warnings(
      v_target_org, 'biometricos'::public.booking_kind, v_normalized
    );

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
  v_warnings := COALESCE(v_warnings, '[]'::JSONB) ||
    public.agenda_capacity_zero_closure_warnings(
      v_target_org, 'firmas'::public.booking_kind, v_normalized
    );

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

COMMENT ON FUNCTION public.upsert_agenda_config_biometricos(JSONB, UUID) IS
  'Mesa admin: upsert biométricos; P126 permite capacity_by_time=0 como cierre.';
COMMENT ON FUNCTION public.upsert_agenda_config_firmas(JSONB, UUID) IS
  'Mesa admin: upsert firmas; P126 permite capacity_by_time=0 como cierre.';
