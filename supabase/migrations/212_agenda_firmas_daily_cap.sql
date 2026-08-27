-- ConCasa CRM — P212: Firmas daily cap 15/sede canónica + hourly 5/5/5 (08/09/10).
-- Cloud max at authoring = 211. 0 mutación de citas históricas / Sheet writes.
-- Activación: EXPLÍCITA vía agenda_firmas_daily_cap_contract (default OFF)
--   + scripts/p212-activate-firmas.sql (agenda_config slots target + enable).
-- INSTALL: contract OFF + rules 15/15 + helpers. NO muta agenda_config/bookings/expedientes.
-- Enforcement Firmas daily/hourly SOLO con contract ON (capacity() gated; assert/gate/claim).

INSERT INTO public.agenda_daily_capacity_rules (kind, location_id, capacity)
VALUES
  ('firmas', 'monterrey', 15),
  ('firmas', 'apodaca', 15)
ON CONFLICT (kind, location_id) DO UPDATE
SET capacity = EXCLUDED.capacity, updated_at = NOW();

COMMENT ON TABLE public.agenda_daily_capacity_rules IS
  'P208/P212: tope diario. Bio MTY=15. Firmas MTY/APO=15 (def); enforcement Firmas solo con contract ON.';

CREATE TABLE IF NOT EXISTS public.agenda_firmas_daily_cap_contract (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Fecha opcional configurada AL PUBLICAR (dato, no constante de código).
  effective_from DATE,
  enabled_at TIMESTAMPTZ,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.agenda_firmas_daily_cap_contract (singleton, enabled, effective_from, note)
VALUES (
  TRUE,
  FALSE,
  NULL,
  'P212: default OFF. Activar solo tras append Sheet 5/5/5 + publicación controlada.'
)
ON CONFLICT (singleton) DO NOTHING;

COMMENT ON TABLE public.agenda_firmas_daily_cap_contract IS
  'P212 Fase 1.7: interruptor explícito del contrato Firmas daily/hourly. Sin fecha fija en código.';

CREATE OR REPLACE FUNCTION public.agenda_firmas_daily_cap_contract_enabled(p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_firmas_daily_cap_contract c
    WHERE c.singleton
      AND c.enabled
      AND (
        c.effective_from IS NULL
        OR COALESCE(p_date, CURRENT_DATE) >= c.effective_from
      )
  );
$$;

COMMENT ON FUNCTION public.agenda_firmas_daily_cap_contract_enabled(DATE) IS
  'P212: true solo si contrato enabled=true (y p_date >= effective_from si está seteado). Default OFF.';

-- Firmas: regla 15 puede existir en INSTALL, pero capacity() solo aplica con contract ON.
-- Biométricos: sin cambio (sigue leyendo agenda_daily_capacity_rules directo).
CREATE OR REPLACE FUNCTION public.agenda_daily_capacity(
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
  v_kind TEXT;
BEGIN
  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind = 'firmas'
     AND NOT public.agenda_firmas_daily_cap_contract_enabled(p_date) THEN
    RETURN NULL;
  END IF;

  RETURN (
    SELECT r.capacity
    FROM public.agenda_daily_capacity_rules r
    WHERE r.kind = v_kind
      AND r.location_id = lower(btrim(COALESCE(p_location, '')))
    LIMIT 1
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_daily_capacity(UUID, TEXT, DATE, TEXT) IS
  'P212: capacity diaria. Firmas gated por contract; bio/otros leen rules directo.';

REVOKE ALL ON FUNCTION public.agenda_daily_capacity(UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_daily_capacity(UUID, TEXT, DATE, TEXT)
  TO authenticated, service_role, postgres;

REVOKE ALL ON TABLE public.agenda_firmas_daily_cap_contract FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agenda_firmas_daily_cap_contract TO authenticated, service_role;
GRANT ALL ON TABLE public.agenda_firmas_daily_cap_contract TO service_role;

CREATE OR REPLACE FUNCTION public.agenda_firmas_canonical_location_id(p_location TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_location, '')))
    WHEN 'monterrey' THEN 'monterrey'
    WHEN 'apodaca' THEN 'apodaca'
    WHEN 'mty-centro' THEN 'monterrey'
    WHEN 'mty_centro' THEN 'monterrey'
    WHEN 'sede-centro' THEN 'monterrey'
    WHEN 'san-nicolas' THEN 'apodaca'
    WHEN 'san_nicolas' THEN 'apodaca'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.agenda_firmas_canonical_location_id(TEXT) IS
  'P212: sede canónica Firmas (monterrey|apodaca). mty-centro → monterrey sin migrar location_id histórico.';

CREATE OR REPLACE FUNCTION public.agenda_firmas_target_hourly_capacity(
  p_canonical_location TEXT,
  p_time_label TEXT
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(btrim(COALESCE(p_canonical_location, ''))) IN ('monterrey', 'apodaca')
         AND btrim(COALESCE(p_time_label, '')) IN ('08:00', '09:00', '10:00')
    THEN 5
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_firmas_count_slot_booked_canonical(
  p_org UUID,
  p_date DATE,
  p_time TIME,
  p_canonical_location TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.agenda_bookings b
  WHERE b.organization_id = p_org
    AND b.kind = 'firmas'
    AND b.booking_date = p_date
    AND b.booking_time = p_time
    AND b.status = 'booked'
    AND public.agenda_firmas_canonical_location_id(b.location_id) = lower(btrim(p_canonical_location));
$$;

CREATE OR REPLACE FUNCTION public.agenda_firmas_daily_active_occupancy(
  p_org UUID,
  p_date DATE,
  p_canonical_location TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH canonical AS (
    SELECT lower(btrim(COALESCE(p_canonical_location, ''))) AS loc
  ),
  crm AS (
    SELECT b.id
    FROM public.agenda_bookings b
    CROSS JOIN canonical c
    WHERE b.organization_id = p_org
      AND b.kind = 'firmas'
      AND b.booking_date = p_date
      AND b.status = 'booked'
      AND public.agenda_firmas_canonical_location_id(b.location_id) = c.loc
  ),
  inv AS (
    SELECT i.status, i.booking_id
    FROM public.agenda_sheet_slot_inventory i
    CROSS JOIN canonical c
    WHERE i.organization_id = p_org
      AND i.kind = 'firmas'
      AND i.booking_date = p_date
      AND i.location_id = c.loc
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

COMMENT ON FUNCTION public.agenda_firmas_daily_active_occupancy(UUID, DATE, TEXT) IS
  'P212: ocupación diaria Firmas canonical-aware. CRM aliases + Sheet sin doble conteo.';

CREATE OR REPLACE FUNCTION public.agenda_firmas_daily_remaining(
  p_org UUID,
  p_date DATE,
  p_canonical_location TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_canonical TEXT;
  v_cap INTEGER;
  v_occ INTEGER;
BEGIN
  v_canonical := public.agenda_firmas_canonical_location_id(p_canonical_location);
  IF v_canonical IS NULL THEN
    RETURN NULL;
  END IF;
  v_cap := public.agenda_daily_capacity(p_org, 'firmas', p_date, v_canonical);
  IF v_cap IS NULL THEN
    RETURN NULL;
  END IF;
  v_occ := public.agenda_firmas_daily_active_occupancy(p_org, p_date, v_canonical);
  IF v_occ > v_cap THEN
    RETURN 0;
  END IF;
  RETURN GREATEST(0, v_cap - v_occ);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_firmas_daily_cap_contract_enabled(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_firmas_canonical_location_id(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_firmas_target_hourly_capacity(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_firmas_count_slot_booked_canonical(UUID, DATE, TIME, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_firmas_daily_active_occupancy(UUID, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_firmas_daily_remaining(UUID, DATE, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.agenda_firmas_daily_cap_contract_enabled(DATE)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_canonical_location_id(TEXT)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_target_hourly_capacity(TEXT, TEXT)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_count_slot_booked_canonical(UUID, DATE, TIME, TEXT)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_daily_active_occupancy(UUID, DATE, TEXT)
  TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_firmas_daily_remaining(UUID, DATE, TEXT)
  TO authenticated, service_role, postgres;


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
  v_inventory_location TEXT;
  v_canonical TEXT;
BEGIN
  v_inventory_location := p_location;
  IF lower(btrim(COALESCE(p_kind, ''))) = 'firmas'
     AND public.agenda_firmas_daily_cap_contract_enabled(p_date) THEN
    v_canonical := public.agenda_firmas_canonical_location_id(p_location);
    IF v_canonical IS NOT NULL THEN
      v_inventory_location := v_canonical;
    END IF;
  END IF;

  PERFORM public.agenda_sheet_assert_inventory_allows_booking(
    p_org, p_kind, p_date, p_time, v_inventory_location
  );

  IF NOT public.agenda_sheet_inventory_enforced(p_date) THEN
    RETURN;
  END IF;
  IF NOT public.agenda_sheet_inventory_applies(v_inventory_location) THEN
    RETURN;
  END IF;

  v_available := public.agenda_sheet_inventory_available_count(
    p_org, p_kind, p_date, p_time, v_inventory_location
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

  -- Firmas: daily cap SOLO con contrato ON. Nunca caer al path biométricos.
  IF lower(btrim(COALESCE(p_kind, ''))) = 'firmas' THEN
    IF public.agenda_firmas_daily_cap_contract_enabled(p_date) THEN
      v_canonical := public.agenda_firmas_canonical_location_id(p_location);
      IF v_canonical IS NOT NULL THEN
        v_daily := public.agenda_firmas_daily_remaining(p_org, p_date, v_canonical);
        IF v_daily IS NOT NULL AND v_daily < 1 THEN
          RAISE EXCEPTION
            'SIN_CUPO_DIA: El cupo diario de firmas está completo (máximo 15 personas por sede).'
            USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
    RETURN;
  END IF;

  v_daily := public.agenda_daily_remaining(p_org, p_kind, p_date, p_location);
  IF v_daily IS NOT NULL AND v_daily < 1 THEN
    RAISE EXCEPTION
      'SIN_CUPO_DIA: El cupo diario de biométricos Monterrey está completo (máximo 15 personas).'
      USING ERRCODE = '22023';
  END IF;
END;
$$;


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
  v_canonical TEXT;
  v_daily_rem INTEGER;
  v_inventory_location TEXT;
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

  v_canonical := public.agenda_firmas_canonical_location_id(p_location_id);

  -- P212: contrato diario Firmas (canonical + 08/09/10 + 5/5/5 + daily 15).
  IF public.agenda_firmas_daily_cap_contract_enabled(v_booking_date) THEN
    IF v_canonical IS NULL THEN
      RAISE EXCEPTION 'agenda_config: sede firmas no permitida'
        USING ERRCODE = '22023';
    END IF;

    -- Lock order: daily ANTES de slot (org+kind+fecha+sede canónica).
    PERFORM public.agenda_advisory_lock_daily_capacity(
      p_org_id, 'firmas', v_booking_date, v_canonical
    );

    v_min_lead_hours := public.agenda_firmas_min_lead_hours(v_config);
    IF p_scheduled_at < NOW() + (v_min_lead_hours || ' hours')::INTERVAL THEN
      RAISE EXCEPTION 'agenda_config: fecha no cumple anticipación mínima'
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

    IF v_time_label NOT IN ('08:00', '09:00', '10:00') THEN
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

    v_daily_rem := public.agenda_firmas_daily_remaining(p_org_id, v_booking_date, v_canonical);
    IF v_daily_rem IS NOT NULL AND v_daily_rem < 1 THEN
      RAISE EXCEPTION
        'SIN_CUPO_DIA: El cupo diario de firmas está completo (máximo 15 personas por sede).'
        USING ERRCODE = '22023';
    END IF;

    PERFORM public.agenda_advisory_lock_slot_capacity(
      p_org_id, 'firmas'::public.booking_kind, v_canonical, v_booking_date, v_booking_time
    );

    v_capacity := public.agenda_firmas_target_hourly_capacity(v_canonical, v_time_label);
    IF v_capacity IS NULL OR v_capacity < 1 THEN
      RAISE EXCEPTION 'agenda_config: cupo no configurado para horario'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_resolved
    FROM public.agenda_resolve_slot_capacity(
      p_org_id, 'firmas'::public.booking_kind,
      v_booking_date, v_booking_time, v_canonical,
      v_capacity
    );

    IF v_resolved.active IS NOT TRUE THEN
      RAISE EXCEPTION 'agenda_config: horario desactivado'
        USING ERRCODE = '22023';
    END IF;

    IF v_resolved.from_override THEN
      v_capacity := GREATEST(1, v_resolved.capacity);
    END IF;

    v_booked_count := public.agenda_firmas_count_slot_booked_canonical(
      p_org_id, v_booking_date, v_booking_time, v_canonical
    );

    IF v_booked_count >= v_capacity THEN
      RAISE EXCEPTION 'agenda_config: cupo firmas agotado'
        USING ERRCODE = '22023';
    END IF;

    v_inventory_location := v_canonical;
    PERFORM public.agenda_sheet_inventory_gate_after_config_assert(
      p_org_id,
      'firmas',
      v_booking_date,
      v_booking_time,
      v_inventory_location,
      v_capacity,
      v_booked_count
    );

    RETURN jsonb_build_object(
      'agenda_config_applied', true,
      'timezone', v_tz,
      'booking_date', v_booking_date,
      'booking_time', v_booking_time,
      'location_id', p_location_id,
      'canonical_location_id', v_canonical,
      'capacity_per_slot', v_capacity,
      'booked_count_before', v_booked_count,
      'capacity_from_override', v_resolved.from_override,
      'firmas_daily_cap_contract', true
    );
  END IF;

  -- Legacy: contrato desactivado — comportamiento mig. 131 sin daily cap Firmas.
  v_min_lead_hours := public.agenda_firmas_min_lead_hours(v_config);
  IF p_scheduled_at < NOW() + (v_min_lead_hours || ' hours')::INTERVAL THEN
    RAISE EXCEPTION 'agenda_config: fecha no cumple anticipación mínima'
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

  IF (v_config ? 'slots')
     AND jsonb_typeof(v_config->'slots') = 'array'
     AND jsonb_array_length(v_config->'slots') = 0 THEN
    RAISE EXCEPTION 'agenda_config: horarios firmas no configurados'
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

  v_recurrent := public.agenda_location_explicit_capacity(v_location_cfg, v_time_label);

  PERFORM public.agenda_advisory_lock_slot_capacity(
    p_org_id, 'firmas'::public.booking_kind, p_location_id, v_booking_date, v_booking_time
  );

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

  PERFORM public.agenda_sheet_inventory_gate_after_config_assert(
    p_org_id,
    'firmas',
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

COMMENT ON FUNCTION public.agenda_firmas_assert_slot_available(uuid, timestamptz, text) IS
  'P212: assert cupo firmas + daily cap canonical + gate inventario Sheet.';


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
  v_canonical TEXT;
  v_inventory_location TEXT;
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

  IF NEW.kind::TEXT = 'firmas' THEN
    IF public.agenda_firmas_daily_cap_contract_enabled(NEW.booking_date) THEN
      v_canonical := public.agenda_firmas_canonical_location_id(NEW.location_id);
      IF v_canonical IS NOT NULL THEN
        v_cap := public.agenda_daily_capacity(
          NEW.organization_id, 'firmas', NEW.booking_date, v_canonical
        );
        IF v_cap IS NOT NULL THEN
          v_occ := public.agenda_firmas_daily_active_occupancy(
            NEW.organization_id, NEW.booking_date, v_canonical
          );
          IF v_occ > v_cap THEN
            RAISE EXCEPTION
              'SIN_CUPO_DIA: El cupo diario de firmas está completo (máximo 15 personas por sede).'
              USING ERRCODE = '22023';
          END IF;
        END IF;
      END IF;
    END IF;
    -- Contract OFF: no aplicar path biométricos a Firmas.
  ELSE
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
  END IF;

  v_inventory_location := NEW.location_id;
  IF NEW.kind::TEXT = 'firmas'
     AND public.agenda_firmas_daily_cap_contract_enabled(NEW.booking_date) THEN
    v_canonical := public.agenda_firmas_canonical_location_id(NEW.location_id);
    IF v_canonical IS NOT NULL THEN
      v_inventory_location := v_canonical;
    END IF;
  END IF;

  IF NEW.kind::TEXT = 'inscripcion' THEN
    SELECT i.id INTO v_inv_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = NEW.organization_id
      AND i.booking_date = NEW.booking_date
      AND i.kind = 'inscripcion'
      AND i.location_id = v_inventory_location
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
      AND i.location_id = v_inventory_location
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
