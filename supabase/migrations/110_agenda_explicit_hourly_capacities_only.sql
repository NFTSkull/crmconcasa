-- ConCasa CRM — P124: cupos solo explícitos por horario (sin fallback capacity_per_slot)
-- 1) Conversión única: slots × sedes activas sin capacity_by_time ← capacity_per_slot
-- 2) Asserts: agenda_slot_capacities → capacity_by_time; si falta → error
-- No modifica Notificación. No altera bookings.

-- =============================================================================
-- Helper: solo capacity_by_time (NULL si falta)
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
  IF v_cap IS NULL OR v_cap < 1 THEN
    RETURN NULL;
  END IF;
  RETURN v_cap;
END;
$$;

COMMENT ON FUNCTION public.agenda_location_explicit_capacity(JSONB, TEXT) IS
  'P124: cupo explícito capacity_by_time[hora]; NULL si no existe (sin fallback capacity_per_slot).';

REVOKE ALL ON FUNCTION public.agenda_location_explicit_capacity(JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_location_explicit_capacity(JSONB, TEXT) TO authenticated, service_role;

-- Compat: helper P123 ya no usa capacity_per_slot
CREATE OR REPLACE FUNCTION public.agenda_location_fallback_capacity(
  p_location_cfg JSONB,
  p_time_label TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN COALESCE(public.agenda_location_explicit_capacity(p_location_cfg, p_time_label), NULL);
END;
$$;

COMMENT ON FUNCTION public.agenda_location_fallback_capacity(JSONB, TEXT) IS
  'P124: alias de agenda_location_explicit_capacity (sin fallback capacity_per_slot).';

-- =============================================================================
-- Conversión única histórica
-- =============================================================================
DO $$
DECLARE
  v_row RECORD;
  v_config JSONB;
  v_slots JSONB;
  v_locations JSONB;
  v_slot TEXT;
  v_loc_id TEXT;
  v_loc JSONB;
  v_cbt JSONB;
  v_general INTEGER;
  v_changed BOOLEAN;
  v_incomplete TEXT[] := ARRAY[]::TEXT[];
  v_key TEXT;
BEGIN
  FOR v_row IN
    SELECT id, organization_id, kind, config
    FROM public.agenda_config
    WHERE kind IN ('biometricos'::public.booking_kind, 'firmas'::public.booking_kind)
  LOOP
    v_config := CASE
      WHEN v_row.kind = 'biometricos' THEN public.agenda_biometricos_normalize_config(v_row.config)
      ELSE public.agenda_firmas_normalize_config(v_row.config)
    END;
    v_slots := COALESCE(v_config->'slots', '[]'::JSONB);
    v_locations := COALESCE(v_config->'locations', '{}'::JSONB);
    v_changed := false;

    IF jsonb_typeof(v_slots) <> 'array' OR jsonb_typeof(v_locations) <> 'object' THEN
      CONTINUE;
    END IF;

    FOR v_slot IN SELECT jsonb_array_elements_text(v_slots) LOOP
      FOR v_loc_id, v_loc IN SELECT key, value FROM jsonb_each(v_locations) LOOP
        IF COALESCE((v_loc->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
          CONTINUE;
        END IF;
        v_cbt := COALESCE(v_loc->'capacity_by_time', '{}'::JSONB);
        IF jsonb_typeof(v_cbt) <> 'object' THEN
          v_cbt := '{}'::JSONB;
        END IF;
        IF (v_cbt ? v_slot) THEN
          BEGIN
            IF (v_cbt->>v_slot)::INTEGER >= 1 THEN
              CONTINUE;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END IF;

        BEGIN
          v_general := (v_loc->>'capacity_per_slot')::INTEGER;
        EXCEPTION WHEN OTHERS THEN
          v_general := NULL;
        END;

        IF v_general IS NULL OR v_general < 1 THEN
          v_key := format('%s/%s/%s/%s', v_row.organization_id, v_row.kind, v_loc_id, v_slot);
          v_incomplete := array_append(v_incomplete, v_key);
          CONTINUE;
        END IF;

        v_cbt := jsonb_set(v_cbt, ARRAY[v_slot], to_jsonb(v_general), true);
        v_loc := jsonb_set(v_loc, '{capacity_by_time}', v_cbt, true);
        v_locations := jsonb_set(v_locations, ARRAY[v_loc_id], v_loc, true);
        v_changed := true;
      END LOOP;
    END LOOP;

    IF v_changed THEN
      v_config := jsonb_set(v_config, '{locations}', v_locations, true);
      UPDATE public.agenda_config
      SET config = v_config, updated_at = NOW()
      WHERE id = v_row.id;
    END IF;
  END LOOP;

  IF array_length(v_incomplete, 1) IS NOT NULL AND array_length(v_incomplete, 1) > 0 THEN
    RAISE EXCEPTION
      'P124 conversión incompleta: faltan capacity_by_time y capacity_per_slot válido en: %',
      array_to_string(v_incomplete, ', ')
      USING ERRCODE = 'P0001';
  END IF;
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

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_org_id::TEXT || ':biometricos:' || v_booking_date::TEXT || ':' || v_time_label || ':' || p_location_id
    )
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

  PERFORM pg_advisory_xact_lock(
    hashtext(
      p_org_id::TEXT || ':firmas:' || v_booking_date::TEXT || ':' || v_time_label || ':' || p_location_id
    )
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

COMMENT ON FUNCTION public.agenda_biometricos_assert_slot_available(uuid, timestamp with time zone, text) IS
  'Assert biométricos P124: override fecha → capacity_by_time; sin capacity_per_slot.';
COMMENT ON FUNCTION public.agenda_firmas_assert_slot_available(uuid, timestamp with time zone, text) IS
  'Assert firmas P124: override fecha → capacity_by_time; sin capacity_per_slot.';
