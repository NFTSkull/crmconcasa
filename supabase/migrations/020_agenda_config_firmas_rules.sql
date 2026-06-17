-- ConCasa CRM — P2C-18 agenda_config rules para book_firmas

-- =============================================================================
-- Índice único parcial: un booking firmas activo por expediente
-- =============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS agenda_bookings_one_active_firmas_per_expediente_idx
  ON public.agenda_bookings (expediente_id, kind)
  WHERE kind = 'firmas'::public.booking_kind
    AND status = 'booked'::public.booking_status;

-- =============================================================================
-- Normalización config firmas
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_firmas_normalize_config(p_config JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_config JSONB := COALESCE(p_config, '{}'::JSONB);
  v_defaults JSONB := jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Monterrey',
    'min_lead_hours', 24,
    'allowed_weekdays', jsonb_build_array(1, 2, 3, 4, 5),
    'locations', jsonb_build_object(
      'mty-centro', jsonb_build_object('enabled', true, 'capacity_per_slot', 3)
    ),
    'slots', jsonb_build_array('09:00', '10:00', '11:00', '12:00', '16:00')
  );
  v_min_lead_hours INTEGER;
BEGIN
  IF v_config ? 'min_lead_hours' THEN
    v_min_lead_hours := GREATEST((v_config->>'min_lead_hours')::INTEGER, 0);
  ELSIF v_config ? 'minLeadDays' THEN
    v_min_lead_hours := GREATEST((v_config->>'minLeadDays')::INTEGER, 0) * 24;
  ELSE
    v_min_lead_hours := (v_defaults->>'min_lead_hours')::INTEGER;
  END IF;

  v_config := v_config
    - 'minLeadDays'
    - 'slotsPerDay'
    || jsonb_build_object('min_lead_hours', v_min_lead_hours);

  IF NOT (v_config ? 'enabled') THEN
    v_config := v_config || jsonb_build_object('enabled', v_defaults->'enabled');
  END IF;

  IF NOT (v_config ? 'timezone')
     OR NULLIF(btrim(COALESCE(v_config->>'timezone', '')), '') IS NULL THEN
    v_config := v_config || jsonb_build_object('timezone', v_defaults->>'timezone');
  END IF;

  IF NOT (v_config ? 'allowed_weekdays') THEN
    v_config := v_config || jsonb_build_object('allowed_weekdays', v_defaults->'allowed_weekdays');
  END IF;

  IF NOT (v_config ? 'locations') THEN
    v_config := v_config || jsonb_build_object('locations', v_defaults->'locations');
  ELSIF jsonb_typeof(v_config->'locations') = 'object'
     AND v_config->'locations' <> '{}'::JSONB THEN
    v_config := v_config || jsonb_build_object(
      'locations', (v_defaults->'locations') || (v_config->'locations')
    );
  END IF;

  IF NOT (v_config ? 'slots') THEN
    v_config := v_config || jsonb_build_object('slots', v_defaults->'slots');
  END IF;

  RETURN v_config;
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_config_normalize_firmas_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'firmas' THEN
    NEW.config := public.agenda_firmas_normalize_config(NEW.config);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agenda_config_normalize_firmas ON public.agenda_config;

CREATE TRIGGER agenda_config_normalize_firmas
  BEFORE INSERT OR UPDATE ON public.agenda_config
  FOR EACH ROW
  WHEN (NEW.kind = 'firmas')
  EXECUTE FUNCTION public.agenda_config_normalize_firmas_trigger();

UPDATE public.agenda_config
SET config = public.agenda_firmas_normalize_config(config)
WHERE kind = 'firmas';

CREATE OR REPLACE FUNCTION public.agenda_firmas_min_lead_hours(p_config JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST((p_config->>'min_lead_hours')::INTEGER, 0);
$$;

CREATE OR REPLACE FUNCTION public.agenda_firmas_count_slot_booked(
  p_org_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_location_id TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.agenda_bookings b
  WHERE b.organization_id = p_org_id
    AND b.kind = 'firmas'
    AND b.status = 'booked'
    AND b.booking_date = p_booking_date
    AND b.booking_time = p_booking_time
    AND b.location_id = p_location_id;
$$;

CREATE OR REPLACE FUNCTION public.agenda_firmas_assert_slot_available(
  p_org_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
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
    RAISE EXCEPTION 'agenda_config: timezone firmas no configurado'
      USING ERRCODE = '22023';
  END IF;

  v_local_ts := p_scheduled_at AT TIME ZONE v_tz;
  v_booking_date := v_local_ts::DATE;
  v_booking_time := v_local_ts::TIME;
  v_time_label := to_char(v_local_ts, 'HH24:MI');

  v_min_lead_hours := public.agenda_firmas_min_lead_hours(v_config);
  IF p_scheduled_at < NOW() + (v_min_lead_hours || ' hours')::INTERVAL THEN
    RAISE EXCEPTION 'agenda_config: fecha firmas no cumple anticipación mínima'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'allowed_weekdays')
     OR jsonb_typeof(v_config->'allowed_weekdays') <> 'array'
     OR jsonb_array_length(v_config->'allowed_weekdays') = 0 THEN
    RAISE EXCEPTION 'agenda_config: días firmas no configurados'
      USING ERRCODE = '22023';
  END IF;

  v_iso_dow := EXTRACT(ISODOW FROM v_local_ts)::INTEGER;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_config->'allowed_weekdays') elem
    WHERE (elem #>> '{}')::INTEGER = v_iso_dow
  ) THEN
    RAISE EXCEPTION 'agenda_config: día firmas no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'slots')
     OR jsonb_typeof(v_config->'slots') <> 'array'
     OR jsonb_array_length(v_config->'slots') = 0 THEN
    RAISE EXCEPTION 'agenda_config: horarios firmas no configurados'
      USING ERRCODE = '22023';
  END IF;

  FOR v_slot IN
    SELECT jsonb_array_elements_text(v_config->'slots')
  LOOP
    IF v_time_label = v_slot THEN
      v_slot_allowed := true;
      EXIT;
    END IF;
  END LOOP;

  IF NOT v_slot_allowed THEN
    RAISE EXCEPTION 'agenda_config: horario firmas no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'locations')
     OR jsonb_typeof(v_config->'locations') <> 'object'
     OR v_config->'locations' = '{}'::JSONB THEN
    RAISE EXCEPTION 'agenda_config: sedes firmas no configuradas'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config->'locations' ? p_location_id) THEN
    RAISE EXCEPTION 'agenda_config: sede firmas no permitida'
      USING ERRCODE = '22023';
  END IF;

  v_location_cfg := v_config->'locations'->p_location_id;
  IF COALESCE((v_location_cfg->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: sede firmas deshabilitada'
      USING ERRCODE = '22023';
  END IF;

  v_capacity := COALESCE((v_location_cfg->>'capacity_per_slot')::INTEGER, 1);
  IF v_capacity < 1 THEN
    v_capacity := 1;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(
      'firmas:' || p_org_id::TEXT || ':' || v_booking_date::TEXT || ':' || v_time_label || ':' || p_location_id
    )
  );

  v_booked_count := public.agenda_firmas_count_slot_booked(
    p_org_id,
    v_booking_date,
    v_booking_time,
    p_location_id
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
    'booked_count_before', v_booked_count
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_firmas_assert_slot_available(UUID, TIMESTAMPTZ, TEXT) IS
  'Valida agenda_config firmas (anticipación, día, slot, sede, cupo) y aplica lock transaccional por slot.';
