-- ConCasa CRM — Transforma aliases 137 (1:1) → many-to-one (mig. 138)
-- NO modifica el archivo ni el historial de 137.
-- Biométricos MTY/APO:
--   lógico 08:00 ← físicos [08:30]
--   lógico 10:00 ← físicos [10:00, 11:00]
-- Firmas: sin aliases nuevos.
-- Overrides org: se conservan; seeds 137 (solo 08:00→08:30) se EXPANDEN al pool 10:00
-- (no DELETE). Overrides ambiguos → RAISE (bloquea migración).

BEGIN;

-- =============================================================================
-- 0) Preflight: overrides ambiguos / físicos duplicados
-- =============================================================================
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  -- Un sheet_start_time no puede mapear a dos logicals distintos (activos) en el mismo scope.
  SELECT string_agg(
    format('%s/%s/%s sheet=%s logicals=%s', organization_id, location_id, kind,
           sheet_start_time, logicals),
    '; '
  )
  INTO v_bad
  FROM (
    SELECT organization_id, location_id, kind, sheet_start_time,
           string_agg(DISTINCT logical_start_time::text, ',') AS logicals,
           count(DISTINCT logical_start_time) AS n
    FROM public.agenda_sheet_time_aliases
    WHERE active
    GROUP BY organization_id, location_id, kind, sheet_start_time
    HAVING count(DISTINCT logical_start_time) > 1
  ) x;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '138_agenda_sheet_time_pool_many_to_one: override ambiguo (físico→varios lógicos): %',
      v_bad
      USING ERRCODE = '22023';
  END IF;

  -- Overrides no-seed (distintos de bio 08:00→08:30 únicamente) deben ser inspeccionados.
  -- Permitidos sin expansión automática: cualquier fila que NO sea exactamente el seed 137.
  -- Si un scope tiene filas además del seed y NO incluye ya el pool 10:00, bloquear.
  SELECT string_agg(format('%s/%s/%s n=%s', organization_id, location_id, kind, n), '; ')
  INTO v_bad
  FROM (
    SELECT a.organization_id, a.location_id, a.kind, count(*)::int AS n
    FROM public.agenda_sheet_time_aliases a
    WHERE a.kind = 'biometricos'
    GROUP BY a.organization_id, a.location_id, a.kind
    HAVING
      -- Tiene algo distinto al seed 08:00→08:30
      EXISTS (
        SELECT 1 FROM public.agenda_sheet_time_aliases b
        WHERE b.organization_id = a.organization_id
          AND b.location_id = a.location_id
          AND b.kind = a.kind
          AND NOT (
            b.logical_start_time = TIME '08:00'
            AND b.sheet_start_time = TIME '08:30'
          )
      )
      -- Y no tiene ya el pool 10:00←11:00
      AND NOT EXISTS (
        SELECT 1 FROM public.agenda_sheet_time_aliases c
        WHERE c.organization_id = a.organization_id
          AND c.location_id = a.location_id
          AND c.kind = a.kind
          AND c.logical_start_time = TIME '10:00'
          AND c.sheet_start_time = TIME '11:00'
      )
  ) y;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      '138_agenda_sheet_time_pool_many_to_one: override org no-seed sin pool 10:00; revisar manualmente: %',
      v_bad
      USING ERRCODE = '22023';
  END IF;
END;
$$;

-- =============================================================================
-- 1) Constraints: 1:1 → many-to-one
-- =============================================================================
ALTER TABLE public.agenda_sheet_time_aliases
  DROP CONSTRAINT IF EXISTS agenda_sheet_time_aliases_times_distinct;
ALTER TABLE public.agenda_sheet_time_aliases
  DROP CONSTRAINT IF EXISTS agenda_sheet_time_aliases_logical_uidx;
ALTER TABLE public.agenda_sheet_time_aliases
  DROP CONSTRAINT IF EXISTS agenda_sheet_time_aliases_logical_sheet_uidx;
ALTER TABLE public.agenda_sheet_time_aliases
  ADD CONSTRAINT agenda_sheet_time_aliases_logical_sheet_uidx
  UNIQUE (organization_id, location_id, kind, logical_start_time, sheet_start_time);

ALTER TABLE public.agenda_sheet_time_alias_defaults
  DROP CONSTRAINT IF EXISTS agenda_sheet_time_alias_defaults_times_distinct;
ALTER TABLE public.agenda_sheet_time_alias_defaults
  DROP CONSTRAINT IF EXISTS agenda_sheet_time_alias_defaults_logical_uidx;
ALTER TABLE public.agenda_sheet_time_alias_defaults
  DROP CONSTRAINT IF EXISTS agenda_sheet_time_alias_defaults_logical_sheet_uidx;
ALTER TABLE public.agenda_sheet_time_alias_defaults
  ADD CONSTRAINT agenda_sheet_time_alias_defaults_logical_sheet_uidx
  UNIQUE (location_id, kind, logical_start_time, sheet_start_time);

COMMENT ON TABLE public.agenda_sheet_time_aliases IS
  'Override org many-to-one: conjunto completo reemplaza defaults (no merge).';
COMMENT ON TABLE public.agenda_sheet_time_alias_defaults IS
  'Defaults globales many-to-one. Orgs sin override heredan el conjunto completo.';

-- =============================================================================
-- 2) Defaults: expandir a pool 10:00 (conservar 08:00←08:30)
-- =============================================================================
INSERT INTO public.agenda_sheet_time_alias_defaults (
  location_id, kind, logical_start_time, sheet_start_time, active
)
VALUES
  ('monterrey', 'biometricos', TIME '08:00', TIME '08:30', TRUE),
  ('monterrey', 'biometricos', TIME '10:00', TIME '10:00', TRUE),
  ('monterrey', 'biometricos', TIME '10:00', TIME '11:00', TRUE),
  ('apodaca', 'biometricos', TIME '08:00', TIME '08:30', TRUE),
  ('apodaca', 'biometricos', TIME '10:00', TIME '10:00', TRUE),
  ('apodaca', 'biometricos', TIME '10:00', TIME '11:00', TRUE)
ON CONFLICT (location_id, kind, logical_start_time, sheet_start_time) DO NOTHING;

-- =============================================================================
-- 3) Overrides seed 137: EXPANDIR (no borrar) al pool 10:00
--    Auditoría Cloud: solo org 50beae… con 08:00→08:30 MTY/APO (seed).
-- =============================================================================
INSERT INTO public.agenda_sheet_time_aliases (
  organization_id, location_id, kind, logical_start_time, sheet_start_time, active
)
SELECT s.organization_id, s.location_id, 'biometricos', v.logical_t, v.sheet_t, TRUE
FROM (
  -- Scopes que tienen exactamente el seed 08:00→08:30 (y nada más, o ya parcial)
  SELECT DISTINCT a.organization_id, a.location_id
  FROM public.agenda_sheet_time_aliases a
  WHERE a.kind = 'biometricos'
    AND a.logical_start_time = TIME '08:00'
    AND a.sheet_start_time = TIME '08:30'
) s
CROSS JOIN (
  VALUES
    (TIME '10:00', TIME '10:00'),
    (TIME '10:00', TIME '11:00')
) AS v(logical_t, sheet_t)
WHERE NOT EXISTS (
  SELECT 1 FROM public.agenda_sheet_time_aliases x
  WHERE x.organization_id = s.organization_id
    AND x.location_id = s.location_id
    AND x.kind = 'biometricos'
    AND x.logical_start_time = v.logical_t
    AND x.sheet_start_time = v.sheet_t
)
ON CONFLICT (organization_id, location_id, kind, logical_start_time, sheet_start_time)
DO NOTHING;

-- =============================================================================
-- 4) Resolvers many-to-one
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_resolve_logical_time(
  p_organization_id UUID,
  p_location_id TEXT,
  p_kind TEXT,
  p_sheet_time TIME,
  p_on DATE DEFAULT CURRENT_DATE
)
RETURNS TIME
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_override BOOLEAN := FALSE;
  v_logical TIME;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_sheet_time_aliases a
    WHERE a.organization_id = p_organization_id
      AND a.location_id = p_location_id
      AND a.kind = p_kind
      AND (a.effective_from IS NULL OR a.effective_from <= p_on)
      AND (a.effective_to IS NULL OR a.effective_to >= p_on)
  ) INTO v_has_override;

  IF v_has_override THEN
    SELECT CASE WHEN a.active THEN a.logical_start_time ELSE p_sheet_time END
      INTO v_logical
    FROM public.agenda_sheet_time_aliases a
    WHERE a.organization_id = p_organization_id
      AND a.location_id = p_location_id
      AND a.kind = p_kind
      AND a.sheet_start_time = p_sheet_time
      AND (a.effective_from IS NULL OR a.effective_from <= p_on)
      AND (a.effective_to IS NULL OR a.effective_to >= p_on)
    ORDER BY a.updated_at DESC
    LIMIT 1;
    RETURN COALESCE(v_logical, p_sheet_time);
  END IF;

  SELECT d.logical_start_time
    INTO v_logical
  FROM public.agenda_sheet_time_alias_defaults d
  WHERE d.location_id = p_location_id
    AND d.kind = p_kind
    AND d.sheet_start_time = p_sheet_time
    AND d.active
  LIMIT 1;

  RETURN COALESCE(v_logical, p_sheet_time);
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_resolve_sheet_time(
  p_organization_id UUID,
  p_location_id TEXT,
  p_kind TEXT,
  p_logical_time TIME,
  p_on DATE DEFAULT CURRENT_DATE
)
RETURNS TIME
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_override BOOLEAN := FALSE;
  v_sheet TIME;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_sheet_time_aliases a
    WHERE a.organization_id = p_organization_id
      AND a.location_id = p_location_id
      AND a.kind = p_kind
      AND (a.effective_from IS NULL OR a.effective_from <= p_on)
      AND (a.effective_to IS NULL OR a.effective_to >= p_on)
  ) INTO v_has_override;

  IF v_has_override THEN
    SELECT a.sheet_start_time INTO v_sheet
    FROM public.agenda_sheet_time_aliases a
    WHERE a.organization_id = p_organization_id
      AND a.location_id = p_location_id
      AND a.kind = p_kind
      AND a.logical_start_time = p_logical_time
      AND a.active
      AND (a.effective_from IS NULL OR a.effective_from <= p_on)
      AND (a.effective_to IS NULL OR a.effective_to >= p_on)
    ORDER BY a.sheet_start_time ASC
    LIMIT 1;
  ELSE
    SELECT d.sheet_start_time INTO v_sheet
    FROM public.agenda_sheet_time_alias_defaults d
    WHERE d.location_id = p_location_id
      AND d.kind = p_kind
      AND d.logical_start_time = p_logical_time
      AND d.active
    ORDER BY d.sheet_start_time ASC
    LIMIT 1;
  END IF;

  RETURN COALESCE(v_sheet, p_logical_time);
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_resolve_sheet_times(
  p_organization_id UUID,
  p_location_id TEXT,
  p_kind TEXT,
  p_logical_time TIME,
  p_on DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_override BOOLEAN := FALSE;
  v_times TIME[];
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_sheet_time_aliases a
    WHERE a.organization_id = p_organization_id
      AND a.location_id = p_location_id
      AND a.kind = p_kind
      AND (a.effective_from IS NULL OR a.effective_from <= p_on)
      AND (a.effective_to IS NULL OR a.effective_to >= p_on)
  ) INTO v_has_override;

  IF v_has_override THEN
    SELECT COALESCE(array_agg(x.sheet_start_time ORDER BY x.sheet_start_time), ARRAY[]::TIME[])
      INTO v_times
    FROM (
      SELECT DISTINCT a.sheet_start_time
      FROM public.agenda_sheet_time_aliases a
      WHERE a.organization_id = p_organization_id
        AND a.location_id = p_location_id
        AND a.kind = p_kind
        AND a.logical_start_time = p_logical_time
        AND a.active
        AND (a.effective_from IS NULL OR a.effective_from <= p_on)
        AND (a.effective_to IS NULL OR a.effective_to >= p_on)
    ) x;
  ELSE
    SELECT COALESCE(array_agg(x.sheet_start_time ORDER BY x.sheet_start_time), ARRAY[]::TIME[])
      INTO v_times
    FROM (
      SELECT DISTINCT d.sheet_start_time
      FROM public.agenda_sheet_time_alias_defaults d
      WHERE d.location_id = p_location_id
        AND d.kind = p_kind
        AND d.logical_start_time = p_logical_time
        AND d.active
    ) x;
  END IF;

  IF v_times IS NULL OR cardinality(v_times) = 0 THEN
    RETURN jsonb_build_array(to_char(p_logical_time, 'HH24:MI'));
  END IF;

  RETURN (
    SELECT jsonb_agg(to_char(t, 'HH24:MI') ORDER BY t)
    FROM unnest(v_times) AS t
  );
END;
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
        ORDER BY x.location_id, x.kind, x.logical_start_time, x.sheet_start_time
      )
      FROM (
        SELECT d.location_id, d.kind, d.logical_start_time, d.sheet_start_time
        FROM public.agenda_sheet_time_alias_defaults d
        WHERE d.active
          AND (
            v_org IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM public.agenda_sheet_time_aliases a
              WHERE a.organization_id = v_org
                AND a.location_id = d.location_id
                AND a.kind = d.kind
                AND (a.effective_from IS NULL OR a.effective_from <= CURRENT_DATE)
                AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
            )
          )
        UNION ALL
        SELECT a.location_id, a.kind, a.logical_start_time, a.sheet_start_time
        FROM public.agenda_sheet_time_aliases a
        WHERE v_org IS NOT NULL
          AND a.organization_id = v_org
          AND a.active
          AND (a.effective_from IS NULL OR a.effective_from <= CURRENT_DATE)
          AND (a.effective_to IS NULL OR a.effective_to >= CURRENT_DATE)
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

REVOKE ALL ON FUNCTION public.agenda_sheet_resolve_sheet_times(UUID, TEXT, TEXT, TIME, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_resolve_sheet_times(UUID, TEXT, TEXT, TIME, DATE)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_list_time_aliases(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_list_time_aliases(UUID)
  TO service_role, postgres;

-- =============================================================================
-- 5) Claim determinista dentro del pool lógico
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_claim_ai()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id UUID;
BEGIN
  IF NEW.kind IS NULL OR NEW.kind::TEXT NOT IN ('biometricos', 'firmas') THEN
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

  SELECT i.id
  INTO v_inv_id
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = NEW.organization_id
    AND i.booking_date = NEW.booking_date
    AND i.kind = NEW.kind::TEXT
    AND i.location_id = NEW.location_id
    AND i.slot_time = NEW.booking_time
    AND i.status = 'available'
  ORDER BY COALESCE(i.sheet_slot_time, i.slot_time) ASC, i.sheet_row ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

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

COMMIT;
