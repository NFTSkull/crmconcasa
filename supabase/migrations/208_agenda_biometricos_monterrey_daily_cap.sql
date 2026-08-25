-- ConCasa CRM — P208: hard-cap diario Biométricos Monterrey = 15.
-- Cloud max at authoring = 207. 0 mutación de citas históricas / Sheet.
-- Sheets = ocupación; NO define capacidad. Firmas/Inscripción/Apodaca sin tope diario.

CREATE TABLE IF NOT EXISTS public.agenda_daily_capacity_rules (
  kind TEXT NOT NULL CHECK (kind IN ('biometricos', 'firmas', 'inscripcion')),
  location_id TEXT NOT NULL CHECK (location_id IN ('monterrey', 'apodaca')),
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, location_id)
);

ALTER TABLE public.agenda_daily_capacity_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_daily_capacity_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agenda_daily_capacity_rules
  TO postgres, service_role;

INSERT INTO public.agenda_daily_capacity_rules (kind, location_id, capacity)
VALUES ('biometricos', 'monterrey', 15)
ON CONFLICT (kind, location_id) DO NOTHING;

COMMENT ON TABLE public.agenda_daily_capacity_rules IS
  'P208: tope diario empresarial. Hoy solo biometricos+monterrey=15. No es el recuento de filas Sheet.';

CREATE OR REPLACE FUNCTION public.agenda_daily_capacity(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_location TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.capacity
  FROM public.agenda_daily_capacity_rules r
  WHERE r.kind = lower(btrim(COALESCE(p_kind, '')))
    AND r.location_id = lower(btrim(COALESCE(p_location, '')))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.agenda_daily_capacity(UUID, TEXT, DATE, TEXT) IS
  'Capacidad diaria o NULL si no hay regla (p_org/p_date reservados para overrides futuros).';

CREATE OR REPLACE FUNCTION public.agenda_advisory_lock_daily_capacity(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_location TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(
      COALESCE(p_org::text, '') || ':daily:' ||
      COALESCE(p_kind, '') || ':' ||
      COALESCE(p_date::text, '') || ':' ||
      COALESCE(p_location, '')
    )
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_advisory_lock_daily_capacity(UUID, TEXT, DATE, TEXT) IS
  'Lock transaccional org+kind+fecha+sede. No es global de todo el CRM.';

CREATE OR REPLACE FUNCTION public.agenda_daily_active_occupancy(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_location TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH crm AS (
    SELECT b.id
    FROM public.agenda_bookings b
    WHERE b.organization_id = p_org
      AND b.kind::text = p_kind
      AND b.booking_date = p_date
      AND b.location_id = p_location
      AND b.status = 'booked'
  ),
  inv AS (
    SELECT
      i.status,
      i.booking_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = p_org
      AND i.kind = p_kind
      AND i.booking_date = p_date
      AND i.location_id = p_location
  )
  SELECT (
    (SELECT COUNT(*)::INTEGER FROM crm)
    + (
      SELECT COUNT(*)::INTEGER
      FROM inv
      WHERE inv.status IN ('occupied_external', 'conflict')
        AND (
          inv.booking_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM crm c WHERE c.id = inv.booking_id)
        )
    )
    + (
      SELECT COUNT(*)::INTEGER
      FROM inv
      WHERE inv.status IN ('claimed', 'linked')
        AND (
          inv.booking_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM crm c WHERE c.id = inv.booking_id)
        )
    )
  )::INTEGER;
$$;

COMMENT ON FUNCTION public.agenda_daily_active_occupancy(UUID, TEXT, DATE, TEXT) IS
  'P208: CRM booked + externos/conflict/claimed huérfanos. linked/claimed con booking booked no duplican.';

CREATE OR REPLACE FUNCTION public.agenda_daily_remaining(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_location TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap INTEGER;
  v_occ INTEGER;
BEGIN
  v_cap := public.agenda_daily_capacity(p_org, p_kind, p_date, p_location);
  IF v_cap IS NULL THEN
    RETURN NULL;
  END IF;
  v_occ := public.agenda_daily_active_occupancy(p_org, p_kind, p_date, p_location);
  IF v_occ > v_cap THEN
    RETURN 0;
  END IF;
  RETURN GREATEST(0, v_cap - v_occ);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_daily_capacity(UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_advisory_lock_daily_capacity(UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_daily_active_occupancy(UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_daily_remaining(UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.agenda_daily_capacity(UUID, TEXT, DATE, TEXT)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_advisory_lock_daily_capacity(UUID, TEXT, DATE, TEXT)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_daily_active_occupancy(UUID, TEXT, DATE, TEXT)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_daily_remaining(UUID, TEXT, DATE, TEXT)
  TO authenticated, service_role, postgres;


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

  -- P208: lock diario org+kind+fecha+sede ANTES del lock por horario (evita 14→16).
  IF public.agenda_daily_capacity(p_org_id, 'biometricos', v_booking_date, p_location_id) IS NOT NULL THEN
    PERFORM public.agenda_advisory_lock_daily_capacity(
      p_org_id, 'biometricos', v_booking_date, p_location_id
    );
  END IF;

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

  PERFORM public.agenda_sheet_inventory_gate_after_config_assert(
    p_org_id,
    'biometricos',
    v_booking_date,
    v_booking_time,
    p_location_id,
    v_capacity,
    v_booked_count
  );

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


CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_gate_after_config_assert(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_time TIME,
  p_location TEXT,
  p_config_capacity INTEGER,
  p_booked_count INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available INTEGER;
  v_effective INTEGER;
  v_daily INTEGER;
BEGIN
  PERFORM public.agenda_sheet_assert_inventory_allows_booking(
    p_org, p_kind, p_date, p_time, p_location
  );

  IF NOT public.agenda_sheet_inventory_enforced(p_date) THEN
    RETURN;
  END IF;
  IF NOT public.agenda_sheet_inventory_applies(p_location) THEN
    RETURN;
  END IF;

  v_available := public.agenda_sheet_inventory_available_count(
    p_org, p_kind, p_date, p_time, p_location
  );

  v_effective := LEAST(
    GREATEST(COALESCE(p_config_capacity, 0) - COALESCE(p_booked_count, 0), 0),
    COALESCE(v_available, 0)
  );

  IF v_effective < 1 THEN
    RAISE EXCEPTION
      'SIN_CUPO_REAL_EN_SHEET: Ese horario acaba de ocuparse. Selecciona otro disponible.'
      USING ERRCODE = '22023';
  END IF;

  v_daily := public.agenda_daily_remaining(p_org, p_kind, p_date, p_location);
  IF v_daily IS NOT NULL AND v_daily < 1 THEN
    RAISE EXCEPTION
      'SIN_CUPO_DIA: El cupo diario de biométricos Monterrey está completo (máximo 15 personas).'
      USING ERRCODE = '22023';
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_claim_ai()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id UUID;
  v_cap INTEGER;
  v_occ INTEGER;
BEGIN
  IF NEW.kind IS NULL OR NEW.kind::TEXT NOT IN ('biometricos', 'firmas', 'inscripcion') THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'booked' THEN
    RETURN NEW;
  END IF;
  IF NOT public.agenda_sheet_inventory_enforced(NEW.booking_date) THEN
    RETURN NEW;
  END IF;
  IF NOT public.agenda_sheet_inventory_applies(NEW.location_id) THEN
    RETURN NEW;
  END IF;

  v_cap := public.agenda_daily_capacity(
    NEW.organization_id, NEW.kind::TEXT, NEW.booking_date, NEW.location_id
  );
  IF v_cap IS NOT NULL THEN
    v_occ := public.agenda_daily_active_occupancy(
      NEW.organization_id, NEW.kind::TEXT, NEW.booking_date, NEW.location_id
    );
    IF v_occ > v_cap THEN
      RAISE EXCEPTION
        'SIN_CUPO_DIA: El cupo diario de biométricos Monterrey está completo (máximo 15 personas).'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF NEW.kind::TEXT = 'inscripcion' THEN
    SELECT i.id INTO v_inv_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = NEW.organization_id
      AND i.booking_date = NEW.booking_date
      AND i.kind = 'inscripcion'
      AND i.location_id = NEW.location_id
      AND i.status = 'available'
      AND (
        i.sheet_slot_time = TIME '11:00'
        OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
      )
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
  ELSE
    SELECT i.id INTO v_inv_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = NEW.organization_id
      AND i.booking_date = NEW.booking_date
      AND i.kind = NEW.kind::TEXT
      AND i.location_id = NEW.location_id
      AND i.slot_time = NEW.booking_time
      AND i.status = 'available'
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
  END IF;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'claimed',
    booking_id = NEW.id,
    expediente_id = NEW.expediente_id,
    claimed_at = NOW(),
    occupancy_source = 'crm',
    updated_at = NOW()
  WHERE i.id = v_inv_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_availability(
  p_kind TEXT,
  p_date DATE,
  p_location_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_kind TEXT;
  v_loc TEXT;
  v_enforced BOOLEAN;
  v_fresh BOOLEAN;
  v_slots JSONB := '[]'::JSONB;
  v_capacity INT := 0;
  v_available INT := 0;
  v_occupied INT := 0;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.active = true;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind NOT IN ('biometricos', 'firmas', 'inscripcion') THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: kind inválido'
      USING ERRCODE = '22023';
  END IF;

  v_loc := lower(btrim(COALESCE(p_location_id, '')));
  IF v_loc NOT IN ('monterrey', 'apodaca') THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: sede inválida'
      USING ERRCODE = '22023';
  END IF;

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: fecha inválida'
      USING ERRCODE = '22023';
  END IF;

  v_enforced := public.agenda_sheet_inventory_enforced(p_date);
  v_fresh := public.agenda_sheet_inventory_fresh(v_org, p_date);

  IF v_enforced AND NOT v_fresh THEN
    RETURN jsonb_build_object(
      'ok', true,
      'fresh', false,
      'enforced', true,
      'slots', '[]'::JSONB,
      'capacity', 0,
      'available', 0,
      'occupied', 0,
      'daily_capacity', public.agenda_daily_capacity(v_org, v_kind, p_date, v_loc),
      'daily_occupancy', public.agenda_daily_active_occupancy(v_org, v_kind, p_date, v_loc),
      'daily_remaining', public.agenda_daily_remaining(v_org, v_kind, p_date, v_loc),
      'fixed_time', CASE WHEN v_kind = 'inscripcion' THEN '11:00' ELSE NULL END,
      'kind', v_kind,
      'booking_date', p_date,
      'location_id', v_loc
    );
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'slot_time', to_char(s.slot_time, 'HH24:MI:SS'),
      'sheet_slot_time', to_char(s.sheet_slot_time, 'HH24:MI:SS'),
      'available', s.available,
      'physical_total', s.physical_total,
      'capacity', s.physical_total,
      'occupied', GREATEST(s.physical_total - s.available, 0),
      'occupied_external', s.occupied_external,
      'claimed', s.claimed,
      'linked', s.linked,
      'disabled', s.disabled
    )
    ORDER BY s.slot_time
  ), '[]'::JSONB)
  INTO v_slots
  FROM (
    SELECT
      i.slot_time,
      MIN(COALESCE(i.sheet_slot_time, i.slot_time)) AS sheet_slot_time,
      COUNT(*) FILTER (WHERE i.status = 'available')::INTEGER AS available,
      COUNT(*) FILTER (WHERE i.status IS DISTINCT FROM 'disabled')::INTEGER AS physical_total,
      COUNT(*) FILTER (WHERE i.status = 'occupied_external')::INTEGER AS occupied_external,
      COUNT(*) FILTER (WHERE i.status = 'claimed')::INTEGER AS claimed,
      COUNT(*) FILTER (WHERE i.status = 'linked')::INTEGER AS linked,
      COUNT(*) FILTER (WHERE i.status = 'disabled')::INTEGER AS disabled
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = v_org
      AND i.kind = v_kind
      AND i.booking_date = p_date
      AND i.location_id = v_loc
      AND (
        v_kind <> 'inscripcion'
        OR i.sheet_slot_time = TIME '11:00'
        OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
      )
    GROUP BY i.slot_time
  ) s;

  SELECT
    COALESCE(SUM((s->>'physical_total')::INT), 0)::INT,
    COALESCE(SUM((s->>'available')::INT), 0)::INT
  INTO v_capacity, v_available
  FROM jsonb_array_elements(COALESCE(v_slots, '[]'::JSONB)) s;

  v_occupied := GREATEST(v_capacity - v_available, 0);

  RETURN jsonb_build_object(
    'ok', true,
    'fresh', v_fresh,
    'enforced', v_enforced,
    'slots', COALESCE(v_slots, '[]'::JSONB),
    'capacity', v_capacity,
    'available', v_available,
    'occupied', v_occupied,
    'daily_capacity', public.agenda_daily_capacity(v_org, v_kind, p_date, v_loc),
    'daily_occupancy', public.agenda_daily_active_occupancy(v_org, v_kind, p_date, v_loc),
    'daily_remaining', public.agenda_daily_remaining(v_org, v_kind, p_date, v_loc),
    'daily_overcapacity', COALESCE(public.agenda_daily_active_occupancy(v_org, v_kind, p_date, v_loc), 0)
      > COALESCE(public.agenda_daily_capacity(v_org, v_kind, p_date, v_loc), 2147483647),
    'fixed_time', CASE WHEN v_kind = 'inscripcion' THEN '11:00' ELSE NULL END,
    'kind', v_kind,
    'booking_date', p_date,
    'location_id', v_loc
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT) IS
  'P176: contrato histórico fresh/enforced/slots[] + top-level P175 (capacity/available/occupied); kinds biometricos|firmas|inscripcion.';

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT)
  TO authenticated, service_role, postgres;
