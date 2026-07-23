-- ConCasa CRM — P123: capacity_by_time recurrente en agenda_config.locations
-- Precedencia booking: agenda_slot_capacities → capacity_by_time[hora] → capacity_per_slot
-- No modifica agenda_slot_capacities ni migraciones 001–108.

CREATE OR REPLACE FUNCTION public.agenda_location_fallback_capacity(
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
  IF p_location_cfg IS NOT NULL
     AND v_time IS NOT NULL
     AND (p_location_cfg ? 'capacity_by_time')
     AND jsonb_typeof(p_location_cfg->'capacity_by_time') = 'object'
     AND (p_location_cfg->'capacity_by_time' ? v_time) THEN
    BEGIN
      v_cap := (p_location_cfg->'capacity_by_time'->>v_time)::INTEGER;
    EXCEPTION
      WHEN OTHERS THEN
        v_cap := NULL;
    END;
    IF v_cap IS NOT NULL AND v_cap >= 1 THEN
      RETURN v_cap;
    END IF;
  END IF;

  BEGIN
    v_cap := COALESCE((p_location_cfg->>'capacity_per_slot')::INTEGER, 1);
  EXCEPTION
    WHEN OTHERS THEN
      v_cap := 1;
  END;
  RETURN GREATEST(1, COALESCE(v_cap, 1));
END;
$$;

COMMENT ON FUNCTION public.agenda_location_fallback_capacity(JSONB, TEXT) IS
  'P123: cupo recurrente por hora (capacity_by_time) o capacity_per_slot de la sede.';

REVOKE ALL ON FUNCTION public.agenda_location_fallback_capacity(JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_location_fallback_capacity(JSONB, TEXT) TO authenticated, service_role;


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
      RAISE EXCEPTION 'upsert_agenda_config_biometricos: capacity_per_slot debe ser >= 1 (%)', v_location_id
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
        IF v_cbt_cap < 1 THEN
          RAISE EXCEPTION 'upsert_agenda_config_biometricos: capacity_by_time[%] debe ser >= 1 (%)',
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
      RAISE EXCEPTION 'upsert_agenda_config_firmas: capacity_per_slot debe ser >= 1 (%)', v_location_id
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
        IF v_cbt_cap < 1 THEN
          RAISE EXCEPTION 'upsert_agenda_config_firmas: capacity_by_time[%] debe ser >= 1 (%)',
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
  v_fallback INTEGER;
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

  -- P123: capacity_by_time[hora] → capacity_per_slot → min 1
  v_fallback := public.agenda_location_fallback_capacity(v_location_cfg, v_time_label);

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_org_id::TEXT || ':biometricos:' || v_booking_date::TEXT || ':' || v_time_label || ':' || p_location_id
    )
  );

  SELECT * INTO v_resolved
  FROM public.agenda_resolve_slot_capacity(
    p_org_id, 'biometricos'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id, v_fallback
  );

  IF v_resolved.active IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: horario desactivado'
      USING ERRCODE = '22023';
  END IF;

  v_capacity := GREATEST(1, v_resolved.capacity);

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
  v_fallback INTEGER;
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

  -- P123: capacity_by_time[hora] → capacity_per_slot → min 1
  v_fallback := public.agenda_location_fallback_capacity(v_location_cfg, v_time_label);

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_org_id::TEXT || ':firmas:' || v_booking_date::TEXT || ':' || v_time_label || ':' || p_location_id
    )
  );

  SELECT * INTO v_resolved
  FROM public.agenda_resolve_slot_capacity(
    p_org_id, 'firmas'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id, v_fallback
  );

  IF v_resolved.active IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: horario desactivado'
      USING ERRCODE = '22023';
  END IF;

  v_capacity := GREATEST(1, v_resolved.capacity);

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

COMMENT ON FUNCTION public.agenda_biometricos_validate_config(JSONB) IS
  'Valida agenda_config biométricos; P123 permite locations.capacity_by_time.';
COMMENT ON FUNCTION public.agenda_firmas_validate_config(JSONB) IS
  'Valida agenda_config firmas; P123 permite locations.capacity_by_time.';
COMMENT ON FUNCTION public.agenda_biometricos_assert_slot_available(uuid, timestamp with time zone, text) IS
  'Assert biométricos: override fecha → capacity_by_time → capacity_per_slot (P123).';
COMMENT ON FUNCTION public.agenda_firmas_assert_slot_available(uuid, timestamp with time zone, text) IS
  'Assert firmas: override fecha → capacity_by_time → capacity_per_slot (P123).';
