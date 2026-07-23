-- ConCasa CRM — P118: cupos configurables por fecha + hora + sede + kind + org
-- No modifica migraciones 001–102. Fallback a capacity_per_slot de agenda_config.

-- =============================================================================
-- Tabla canónica
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agenda_slot_capacities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  kind public.booking_kind NOT NULL,
  location_id TEXT NOT NULL,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  capacity INTEGER NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  updated_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_slot_capacities_capacity_positive CHECK (capacity > 0),
  CONSTRAINT agenda_slot_capacities_location_nonempty CHECK (btrim(location_id) <> ''),
  CONSTRAINT agenda_slot_capacities_unique_slot
    UNIQUE (organization_id, kind, location_id, slot_date, slot_time)
);

CREATE INDEX IF NOT EXISTS agenda_slot_capacities_lookup_idx
  ON public.agenda_slot_capacities (organization_id, kind, slot_date, location_id);

COMMENT ON TABLE public.agenda_slot_capacities IS
  'P118: capacidad por (org, kind, sede, fecha, hora). Si no hay fila, rige capacity_per_slot de agenda_config.';

ALTER TABLE public.agenda_slot_capacities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_slot_capacities_select ON public.agenda_slot_capacities;
CREATE POLICY agenda_slot_capacities_select
  ON public.agenda_slot_capacities
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.current_organization_id()
    OR public.current_app_role() = 'super_admin'
  );

REVOKE ALL ON TABLE public.agenda_slot_capacities FROM PUBLIC;
GRANT SELECT ON TABLE public.agenda_slot_capacities TO authenticated;
GRANT ALL ON TABLE public.agenda_slot_capacities TO service_role;

-- =============================================================================
-- Resolver capacidad (con lock de fila si existe)
-- =============================================================================
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
  v_fallback INTEGER := GREATEST(1, COALESCE(p_fallback_capacity, 1));
BEGIN
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

REVOKE ALL ON FUNCTION public.agenda_resolve_slot_capacity(UUID, public.booking_kind, DATE, TIME, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_resolve_slot_capacity(UUID, public.booking_kind, DATE, TIME, TEXT, INTEGER) TO authenticated, service_role;

-- =============================================================================
-- Contar booked genérico por kind
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_count_slot_booked(
  p_org_id UUID,
  p_kind public.booking_kind,
  p_slot_date DATE,
  p_slot_time TIME,
  p_location_id TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.agenda_bookings b
  WHERE b.organization_id = p_org_id
    AND b.kind = p_kind
    AND b.booking_date = p_slot_date
    AND b.booking_time = p_slot_time
    AND b.location_id = p_location_id
    AND b.status = 'booked';
$$;

REVOKE ALL ON FUNCTION public.agenda_count_slot_booked(UUID, public.booking_kind, DATE, TIME, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_count_slot_booked(UUID, public.booking_kind, DATE, TIME, TEXT) TO authenticated, service_role;

-- =============================================================================
-- Assert biométricos — cupo por slot (override) + advisory lock
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

  v_fallback := COALESCE((v_location_cfg->>'capacity_per_slot')::INTEGER, 1);
  IF v_fallback < 1 THEN
    v_fallback := 1;
  END IF;

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

-- =============================================================================
-- Assert firmas — espejo P118
-- =============================================================================
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

  v_fallback := COALESCE((v_location_cfg->>'capacity_per_slot')::INTEGER, 1);
  IF v_fallback < 1 THEN
    v_fallback := 1;
  END IF;

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

-- =============================================================================
-- RPC: listar cupos + ocupación para una fecha
-- =============================================================================
CREATE OR REPLACE FUNCTION public.list_agenda_slot_capacities(
  p_kind public.booking_kind,
  p_slot_date DATE,
  p_location_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  kind public.booking_kind,
  location_id TEXT,
  slot_date DATE,
  slot_time TIME,
  capacity INTEGER,
  active BOOLEAN,
  occupied INTEGER,
  available INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_org UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'list_agenda_slot_capacities: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor_id AND p.active = true;

  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin', 'asesor'
  ) THEN
    RAISE EXCEPTION 'list_agenda_slot_capacities: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'super_admin' AND v_org IS NULL THEN
    RAISE EXCEPTION 'list_agenda_slot_capacities: org requerida' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.kind,
    c.location_id,
    c.slot_date,
    c.slot_time,
    c.capacity,
    c.active,
    public.agenda_count_slot_booked(c.organization_id, c.kind, c.slot_date, c.slot_time, c.location_id) AS occupied,
    GREATEST(
      0,
      c.capacity - public.agenda_count_slot_booked(c.organization_id, c.kind, c.slot_date, c.slot_time, c.location_id)
    ) AS available,
    c.created_at,
    c.updated_at
  FROM public.agenda_slot_capacities c
  WHERE c.slot_date = p_slot_date
    AND c.kind = p_kind
    AND (p_location_id IS NULL OR c.location_id = p_location_id)
    AND (v_role = 'super_admin' OR c.organization_id = v_org)
  ORDER BY c.slot_time, c.location_id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_agenda_slot_capacities(public.booking_kind, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agenda_slot_capacities(public.booking_kind, DATE, TEXT) TO authenticated;

-- =============================================================================
-- RPC: upsert cupo (solo admin)
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

  v_occupied := public.agenda_count_slot_booked(v_org, p_kind, p_slot_date, p_slot_time, v_loc);
  IF p_capacity < v_occupied THEN
    RAISE EXCEPTION 'upsert_agenda_slot_capacity: capacidad (%) menor que ocupados (%)',
      p_capacity, v_occupied
      USING ERRCODE = '22023';
  END IF;

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

REVOKE ALL ON FUNCTION public.upsert_agenda_slot_capacity(public.booking_kind, TEXT, DATE, TIME, INTEGER, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_agenda_slot_capacity(public.booking_kind, TEXT, DATE, TIME, INTEGER, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.upsert_agenda_slot_capacity(public.booking_kind, TEXT, DATE, TIME, INTEGER, BOOLEAN) IS
  'P118: Mesa Admin/super_admin define cupo por fecha+hora+sede+kind. No baja capacidad bajo ocupados.';
