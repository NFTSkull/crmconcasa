-- P212 ACTIVATION (NO es migration automática).
-- Ejecutar SOLO después de: Sheet 22/22 5/5/5 + Edges parser + FE ready + publish controlado.
-- Transaccional: cualquier fallo → ROLLBACK (no dejar config target con contract OFF).
--
-- NO ejecutar en Fase 3A (INSTALL contract OFF).

BEGIN;

-- Preconditions
DO $$
DECLARE
  v_enabled BOOLEAN;
  v_bio INTEGER;
  v_firmas_mty INTEGER;
  v_firmas_apo INTEGER;
BEGIN
  SELECT c.enabled INTO v_enabled
  FROM public.agenda_firmas_daily_cap_contract c
  WHERE c.singleton;

  IF v_enabled IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'P212 activate precondition: contract must be enabled=false before activate (got %)', v_enabled;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_bio
  FROM public.agenda_daily_capacity_rules
  WHERE kind = 'biometricos' AND location_id = 'monterrey' AND capacity = 15;
  IF v_bio < 1 THEN
    RAISE EXCEPTION 'P212 activate precondition: biometricos/monterrey=15 missing';
  END IF;
END $$;

-- 1) Daily rules Firmas 15/15 (idempotente; INSTALL ya las crea)
INSERT INTO public.agenda_daily_capacity_rules (kind, location_id, capacity)
VALUES
  ('firmas', 'monterrey', 15),
  ('firmas', 'apodaca', 15)
ON CONFLICT (kind, location_id) DO UPDATE
SET capacity = EXCLUDED.capacity, updated_at = NOW();

-- 2) agenda_config Firmas → slots target 08/09/10 (todas las orgs)
--    Conserva locations/allowed_weekdays/min_lead; solo slots + capacity_by_time.
UPDATE public.agenda_config
SET config = jsonb_set(
  jsonb_set(
    config,
    '{slots}',
    '["08:00","09:00","10:00"]'::JSONB,
    true
  ),
  '{capacity_by_time}',
  '{"08:00":5,"09:00":5,"10:00":5}'::JSONB,
  true
),
updated_at = NOW()
WHERE kind = 'firmas';

-- 3) Enable contract (effective_from debe setearse explícitamente en publish)
--    Placeholder: el operador DEBE reemplazar effective_from antes de COMMIT en prod.
UPDATE public.agenda_firmas_daily_cap_contract
SET enabled = TRUE,
    effective_from = COALESCE(effective_from, CURRENT_DATE),
    enabled_at = NOW(),
    note = 'P212 activated via scripts/p212-activate-firmas.sql',
    updated_at = NOW()
WHERE singleton
  AND enabled = FALSE;

-- Postconditions
DO $$
DECLARE
  v_enabled BOOLEAN;
  v_from DATE;
  v_rules INTEGER;
  v_cfg_slots JSONB;
BEGIN
  SELECT c.enabled, c.effective_from INTO v_enabled, v_from
  FROM public.agenda_firmas_daily_cap_contract c WHERE c.singleton;
  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'P212 activate postcondition: contract not enabled';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_rules
  FROM public.agenda_daily_capacity_rules
  WHERE kind = 'firmas' AND location_id IN ('monterrey', 'apodaca') AND capacity = 15;
  IF v_rules <> 2 THEN
    RAISE EXCEPTION 'P212 activate postcondition: firmas daily rules missing';
  END IF;

  SELECT config->'slots' INTO v_cfg_slots
  FROM public.agenda_config
  WHERE kind = 'firmas'
  LIMIT 1;
  IF v_cfg_slots IS NULL OR v_cfg_slots <> '["08:00","09:00","10:00"]'::JSONB THEN
    RAISE EXCEPTION 'P212 activate postcondition: agenda_config slots not target';
  END IF;
END $$;

COMMIT;
