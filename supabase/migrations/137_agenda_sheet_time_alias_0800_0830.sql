-- ConCasa CRM — Alias horario Sheet físico ↔ CRM lógico (mig. 137)
-- No modifica 134/135/136. No muta agenda_bookings ni outbox.
-- Alias verificado: biometricos monterrey/apodaca 08:00 CRM ⇄ 08:30 Sheet.

-- =============================================================================
-- 1) Tabla de aliases
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agenda_sheet_time_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL CHECK (location_id IN ('monterrey', 'apodaca')),
  kind TEXT NOT NULL CHECK (kind IN ('biometricos', 'firmas')),
  logical_start_time TIME NOT NULL,
  sheet_start_time TIME NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_sheet_time_aliases_times_distinct
    CHECK (logical_start_time IS DISTINCT FROM sheet_start_time),
  -- Un logical activo/inactivo → una sola traducción física (anti 08:00→08:30 y 08:00→09:00)
  CONSTRAINT agenda_sheet_time_aliases_logical_uidx
    UNIQUE (organization_id, location_id, kind, logical_start_time),
  -- Un físico → un solo logical (anti 08:00→08:30 y 08:15→08:30 = doble conteo)
  CONSTRAINT agenda_sheet_time_aliases_sheet_uidx
    UNIQUE (organization_id, location_id, kind, sheet_start_time)
);

DROP TRIGGER IF EXISTS agenda_sheet_time_aliases_set_updated_at
  ON public.agenda_sheet_time_aliases;
CREATE TRIGGER agenda_sheet_time_aliases_set_updated_at
  BEFORE UPDATE ON public.agenda_sheet_time_aliases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agenda_sheet_time_aliases IS
  'Override por organización: CRM logical_start_time ↔ Sheet columna A sheet_start_time.';

ALTER TABLE public.agenda_sheet_time_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_sheet_time_aliases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agenda_sheet_time_aliases
  TO service_role, postgres;

-- Defaults globales (location_id slug canónico). Orgs nuevas heredan sin INSERT manual.
CREATE TABLE IF NOT EXISTS public.agenda_sheet_time_alias_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL CHECK (location_id IN ('monterrey', 'apodaca')),
  kind TEXT NOT NULL CHECK (kind IN ('biometricos', 'firmas')),
  logical_start_time TIME NOT NULL,
  sheet_start_time TIME NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_sheet_time_alias_defaults_times_distinct
    CHECK (logical_start_time IS DISTINCT FROM sheet_start_time),
  CONSTRAINT agenda_sheet_time_alias_defaults_logical_uidx
    UNIQUE (location_id, kind, logical_start_time),
  CONSTRAINT agenda_sheet_time_alias_defaults_sheet_uidx
    UNIQUE (location_id, kind, sheet_start_time)
);

DROP TRIGGER IF EXISTS agenda_sheet_time_alias_defaults_set_updated_at
  ON public.agenda_sheet_time_alias_defaults;
CREATE TRIGGER agenda_sheet_time_alias_defaults_set_updated_at
  BEFORE UPDATE ON public.agenda_sheet_time_alias_defaults
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agenda_sheet_time_alias_defaults IS
  'Defaults globales por location_id/kind. Override org gana si existe y active.';

ALTER TABLE public.agenda_sheet_time_alias_defaults ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_sheet_time_alias_defaults FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agenda_sheet_time_alias_defaults
  TO service_role, postgres;

INSERT INTO public.agenda_sheet_time_alias_defaults (
  location_id, kind, logical_start_time, sheet_start_time, active
)
VALUES
  ('monterrey', 'biometricos', TIME '08:00', TIME '08:30', TRUE),
  ('apodaca', 'biometricos', TIME '08:00', TIME '08:30', TRUE)
ON CONFLICT (location_id, kind, logical_start_time) DO NOTHING;

-- Seed overrides opcionales para orgs existentes (idempotente; no requerido para orgs nuevas)
INSERT INTO public.agenda_sheet_time_aliases (
  organization_id, location_id, kind, logical_start_time, sheet_start_time, active
)
SELECT o.id, v.location_id, 'biometricos', TIME '08:00', TIME '08:30', TRUE
FROM public.organizations o
CROSS JOIN (VALUES ('monterrey'), ('apodaca')) AS v(location_id)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2) Columna física en inventario
-- =============================================================================
ALTER TABLE public.agenda_sheet_slot_inventory
  ADD COLUMN IF NOT EXISTS sheet_slot_time TIME NULL;

COMMENT ON COLUMN public.agenda_sheet_slot_inventory.slot_time IS
  'Horario lógico CRM (post-alias). Usado por availability/claim.';
COMMENT ON COLUMN public.agenda_sheet_slot_inventory.sheet_slot_time IS
  'Horario físico columna A del Sheet. NULL = igual a slot_time (sin alias).';

-- Backfill: sin alias conocido aún, sheet_slot_time = slot_time
UPDATE public.agenda_sheet_slot_inventory
SET sheet_slot_time = slot_time
WHERE sheet_slot_time IS NULL;

-- =============================================================================
-- 3) Helpers de resolución (service_role)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_resolve_logical_time(
  p_organization_id UUID,
  p_location_id TEXT,
  p_kind TEXT,
  p_sheet_time TIME,
  p_on DATE DEFAULT CURRENT_DATE
)
RETURNS TIME
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      -- Override org (activo o no): si inactive → identidad; si active → logical.
      SELECT CASE
        WHEN a.active THEN a.logical_start_time
        ELSE p_sheet_time
      END
      FROM public.agenda_sheet_time_aliases a
      WHERE a.organization_id = p_organization_id
        AND a.location_id = p_location_id
        AND a.kind = p_kind
        AND a.sheet_start_time = p_sheet_time
        AND (a.effective_from IS NULL OR a.effective_from <= p_on)
        AND (a.effective_to IS NULL OR a.effective_to >= p_on)
      ORDER BY a.updated_at DESC
      LIMIT 1
    ),
    (
      SELECT d.logical_start_time
      FROM public.agenda_sheet_time_alias_defaults d
      WHERE d.location_id = p_location_id
        AND d.kind = p_kind
        AND d.sheet_start_time = p_sheet_time
        AND d.active
      LIMIT 1
    ),
    p_sheet_time
  );
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_resolve_sheet_time(
  p_organization_id UUID,
  p_location_id TEXT,
  p_kind TEXT,
  p_logical_time TIME,
  p_on DATE DEFAULT CURRENT_DATE
)
RETURNS TIME
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN a.active THEN a.sheet_start_time
        ELSE p_logical_time
      END
      FROM public.agenda_sheet_time_aliases a
      WHERE a.organization_id = p_organization_id
        AND a.location_id = p_location_id
        AND a.kind = p_kind
        AND a.logical_start_time = p_logical_time
        AND (a.effective_from IS NULL OR a.effective_from <= p_on)
        AND (a.effective_to IS NULL OR a.effective_to >= p_on)
      ORDER BY a.updated_at DESC
      LIMIT 1
    ),
    (
      SELECT d.sheet_start_time
      FROM public.agenda_sheet_time_alias_defaults d
      WHERE d.location_id = p_location_id
        AND d.kind = p_kind
        AND d.logical_start_time = p_logical_time
        AND d.active
      LIMIT 1
    ),
    p_logical_time
  );
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_list_time_aliases(
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();
  v_org := p_organization_id;
  -- Efectivo: defaults + overrides activos. Override inactive suprime el default.
  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'locationId', x.location_id,
          'kind', x.kind,
          'logicalStartTime', to_char(x.logical_start_time, 'HH24:MI'),
          'sheetStartTime', to_char(x.sheet_start_time, 'HH24:MI'),
          'active', TRUE
        )
        ORDER BY x.location_id, x.kind, x.logical_start_time
      )
      FROM (
        SELECT
          d.location_id,
          d.kind,
          COALESCE(o.logical_start_time, d.logical_start_time) AS logical_start_time,
          COALESCE(o.sheet_start_time, d.sheet_start_time) AS sheet_start_time
        FROM public.agenda_sheet_time_alias_defaults d
        LEFT JOIN LATERAL (
          SELECT a.*
          FROM public.agenda_sheet_time_aliases a
          WHERE v_org IS NOT NULL
            AND a.organization_id = v_org
            AND a.location_id = d.location_id
            AND a.kind = d.kind
            AND a.sheet_start_time = d.sheet_start_time
            AND (a.effective_from IS NULL OR a.effective_from <= CURRENT_DATE)
            AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
          ORDER BY a.updated_at DESC
          LIMIT 1
        ) o ON TRUE
        WHERE d.active
          AND (o.id IS NULL OR o.active)
        UNION
        SELECT
          o2.location_id,
          o2.kind,
          o2.logical_start_time,
          o2.sheet_start_time
        FROM public.agenda_sheet_time_aliases o2
        WHERE v_org IS NOT NULL
          AND o2.organization_id = v_org
          AND o2.active
          AND (o2.effective_from IS NULL OR o2.effective_from <= CURRENT_DATE)
          AND (o2.effective_to IS NULL OR o2.effective_to >= CURRENT_DATE)
          AND NOT EXISTS (
            SELECT 1
            FROM public.agenda_sheet_time_alias_defaults d2
            WHERE d2.location_id = o2.location_id
              AND d2.kind = o2.kind
              AND d2.sheet_start_time = o2.sheet_start_time
              AND d2.active
          )
      ) x
    ),
    '[]'::JSONB
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_resolve_logical_time(UUID, TEXT, TEXT, TIME, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_resolve_logical_time(UUID, TEXT, TEXT, TIME, DATE)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_resolve_sheet_time(UUID, TEXT, TEXT, TIME, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_resolve_sheet_time(UUID, TEXT, TEXT, TIME, DATE)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_list_time_aliases(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_list_time_aliases(UUID)
  TO service_role, postgres;

-- =============================================================================
-- 4) upsert_batch: persiste sheet_slot_time
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_upsert_batch(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_count INTEGER := 0;
  v_existing public.agenda_sheet_slot_inventory%ROWTYPE;
  v_status TEXT;
  v_booking_id UUID;
  v_expediente_id UUID;
  v_occ TEXT;
  v_visible_nss TEXT;
  v_visible_name TEXT;
  v_visible_advisor TEXT;
  v_slot_time TIME;
  v_sheet_slot_time TIME;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_upsert_batch: p_rows debe ser array JSON'
      USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_status := NULLIF(btrim(COALESCE(v_elem->>'status', '')), '');
    BEGIN
      v_booking_id := NULLIF(btrim(COALESCE(v_elem->>'booking_id', '')), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_booking_id := NULL;
    END;
    BEGIN
      v_expediente_id := NULLIF(btrim(COALESCE(v_elem->>'expediente_id', '')), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_expediente_id := NULL;
    END;
    v_occ := NULLIF(btrim(COALESCE(v_elem->>'occupancy_source', '')), '');
    v_visible_nss := NULLIF(btrim(COALESCE(v_elem->>'visible_nss', '')), '');
    v_visible_name := NULLIF(btrim(COALESCE(v_elem->>'visible_name', '')), '');
    v_visible_advisor := NULLIF(btrim(COALESCE(v_elem->>'visible_advisor', '')), '');
    v_slot_time := (v_elem->>'slot_time')::TIME;
    BEGIN
      v_sheet_slot_time := NULLIF(btrim(COALESCE(v_elem->>'sheet_slot_time', '')), '')::TIME;
    EXCEPTION WHEN invalid_text_representation THEN
      v_sheet_slot_time := NULL;
    END;
    IF v_sheet_slot_time IS NULL THEN
      v_sheet_slot_time := v_slot_time;
    END IF;

    IF v_status IS NULL OR v_status NOT IN (
      'available', 'occupied_external', 'claimed', 'linked', 'disabled', 'conflict'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_inventory_upsert_batch: status inválido'
        USING ERRCODE = '22023';
    END IF;

    IF v_occ IS NULL OR v_occ NOT IN (
      'sheet_legacy', 'sheet_webhook', 'crm', 'reconciliation'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_inventory_upsert_batch: occupancy_source inválido'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_existing
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.spreadsheet_id = btrim(v_elem->>'spreadsheet_id')
      AND i.sheet_id = (v_elem->>'sheet_id')::BIGINT
      AND i.sheet_row = (v_elem->>'sheet_row')::INTEGER
    FOR UPDATE;

    IF FOUND THEN
      IF v_status = 'available' AND v_existing.booking_id IS NOT NULL THEN
        v_status := v_existing.status;
        v_booking_id := v_existing.booking_id;
        v_expediente_id := v_existing.expediente_id;
        v_occ := v_existing.occupancy_source;
      ELSIF v_status = 'occupied_external'
            AND v_existing.status IN ('claimed', 'linked')
            AND v_existing.booking_id IS NOT NULL
            AND (
              v_booking_id IS NULL
              OR v_booking_id = v_existing.booking_id
            ) THEN
        v_status := v_existing.status;
        v_booking_id := v_existing.booking_id;
        v_expediente_id := COALESCE(v_expediente_id, v_existing.expediente_id);
        v_occ := v_existing.occupancy_source;
      END IF;

      UPDATE public.agenda_sheet_slot_inventory i
      SET
        organization_id = COALESCE(
          NULLIF(btrim(COALESCE(v_elem->>'organization_id', '')), '')::UUID,
          i.organization_id
        ),
        -- Título exacto (no btrim / sin btrim) — mig. 134 + 137
        sheet_title = COALESCE(NULLIF(COALESCE(v_elem->>'sheet_title', ''), ''), i.sheet_title),
        booking_date = COALESCE((v_elem->>'booking_date')::DATE, i.booking_date),
        kind = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'kind', '')), ''), i.kind),
        location_id = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'location_id', '')), ''), i.location_id),
        slot_time = COALESCE(v_slot_time, i.slot_time),
        sheet_slot_time = COALESCE(v_sheet_slot_time, i.sheet_slot_time, i.slot_time),
        slot_key = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'slot_key', '')), ''), i.slot_key),
        status = v_status,
        visible_nss = v_visible_nss,
        visible_name = v_visible_name,
        visible_advisor = v_visible_advisor,
        booking_id = v_booking_id,
        expediente_id = v_expediente_id,
        occupancy_source = v_occ,
        observed_at = NOW(),
        last_error = CASE
          WHEN v_status = 'conflict' THEN COALESCE(v_elem->>'last_error', i.last_error)
          ELSE i.last_error
        END,
        updated_at = NOW()
      WHERE i.id = v_existing.id;
    ELSE
      INSERT INTO public.agenda_sheet_slot_inventory (
        organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date,
        sheet_row, kind, location_id, slot_time, sheet_slot_time, slot_key, status,
        visible_nss, visible_name, visible_advisor,
        booking_id, expediente_id, occupancy_source, observed_at
      ) VALUES (
        (v_elem->>'organization_id')::UUID,
        btrim(v_elem->>'spreadsheet_id'),
        (v_elem->>'sheet_id')::BIGINT,
        COALESCE(v_elem->>'sheet_title', ''),
        (v_elem->>'booking_date')::DATE,
        (v_elem->>'sheet_row')::INTEGER,
        btrim(v_elem->>'kind'),
        btrim(v_elem->>'location_id'),
        v_slot_time,
        v_sheet_slot_time,
        btrim(v_elem->>'slot_key'),
        v_status,
        v_visible_nss,
        v_visible_name,
        v_visible_advisor,
        v_booking_id,
        v_expediente_id,
        v_occ,
        NOW()
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'upserted', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_upsert_batch(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_upsert_batch(JSONB)
  TO service_role, postgres;

-- Availability: conservar contrato 131 + sheet_slot_time por bucket lógico
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
  v_enforced BOOLEAN;
  v_fresh BOOLEAN;
  v_slots JSONB := '[]'::JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: kind inválido'
      USING ERRCODE = '22023';
  END IF;

  IF p_location_id IS NULL OR p_location_id NOT IN ('monterrey', 'apodaca') THEN
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
      'slots', '[]'::JSONB
    );
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'slot_time', to_char(s.slot_time, 'HH24:MI:SS'),
      'sheet_slot_time', to_char(s.sheet_slot_time, 'HH24:MI:SS'),
      'available', s.available,
      'physical_total', s.physical_total,
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
      AND i.kind = p_kind
      AND i.booking_date = p_date
      AND i.location_id = p_location_id
    GROUP BY i.slot_time
  ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'fresh', v_fresh,
    'enforced', v_enforced,
    'slots', COALESCE(v_slots, '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT)
  TO authenticated, service_role, postgres;
