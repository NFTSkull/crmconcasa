-- P212 ACTIVATION (NO es migration automática).
-- Ejecutar SOLO en/after 2026-09-01 (fecha local America/Monterrey).
-- Transaccional: cualquier fallo → ROLLBACK (no dejar config target con contract OFF).
--
-- PROHIBIDO ejecutar antes de 2026-09-01.
-- NO usa CURRENT_DATE / COALESCE(effective_from, today).
-- effective_from siempre = DATE '2026-09-01'.
--
-- Test override (solo local): SET LOCAL app.p212_activate_as_of = 'YYYY-MM-DD';

BEGIN;

DO $$
DECLARE
  v_enabled BOOLEAN;
  v_from DATE;
  v_bio INTEGER;
  v_firmas_mty INTEGER;
  v_firmas_apo INTEGER;
  v_legacy_slots JSONB := '["08:30","09:00","09:30","10:00","10:30"]'::JSONB;
  v_target_slots JSONB := '["08:00","09:00","10:00"]'::JSONB;
  v_target_cbt JSONB := '{"08:00":5,"09:00":5,"10:00":5}'::JSONB;
  v_cfg JSONB;
  v_slots JSONB;
  v_today DATE;
  v_as_of TEXT;
  v_org UUID;
  v_updated INTEGER := 0;
  v_contract_n INTEGER;
BEGIN
  -- ---- Fecha efectiva (Monterrey; override solo tests) ----
  v_as_of := nullif(btrim(current_setting('app.p212_activate_as_of', true)), '');
  IF v_as_of IS NOT NULL THEN
    IF v_as_of !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'P212 activate: app.p212_activate_as_of inválido (%)', v_as_of;
    END IF;
    v_today := v_as_of::DATE;
  ELSE
    v_today := (now() AT TIME ZONE 'America/Monterrey')::date;
  END IF;

  IF v_today < DATE '2026-09-01' THEN
    RAISE EXCEPTION
      'P212 activation blocked before 2026-09-01 (Monterrey local date=%)',
      v_today;
  END IF;

  -- ---- Contract row ----
  SELECT COUNT(*)::INTEGER INTO v_contract_n
  FROM public.agenda_firmas_daily_cap_contract c
  WHERE c.singleton;
  IF v_contract_n <> 1 THEN
    RAISE EXCEPTION 'P212 activate precondition: contract row missing';
  END IF;

  SELECT c.enabled, c.effective_from INTO v_enabled, v_from
  FROM public.agenda_firmas_daily_cap_contract c
  WHERE c.singleton;

  IF v_enabled IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION
      'P212 activate precondition: contract must be enabled=false (got %)',
      v_enabled;
  END IF;

  IF v_from IS NOT NULL AND v_from IS DISTINCT FROM DATE '2026-09-01' THEN
    RAISE EXCEPTION
      'P212 activate precondition: unexpected effective_from=% (want NULL or 2026-09-01)',
      v_from;
  END IF;

  -- ---- Daily rules ----
  SELECT COUNT(*)::INTEGER INTO v_bio
  FROM public.agenda_daily_capacity_rules
  WHERE kind = 'biometricos' AND location_id = 'monterrey' AND capacity = 15;
  IF v_bio < 1 THEN
    RAISE EXCEPTION 'P212 activate precondition: biometricos/monterrey=15 missing';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_firmas_mty
  FROM public.agenda_daily_capacity_rules
  WHERE kind = 'firmas' AND location_id = 'monterrey' AND capacity = 15;
  SELECT COUNT(*)::INTEGER INTO v_firmas_apo
  FROM public.agenda_daily_capacity_rules
  WHERE kind = 'firmas' AND location_id = 'apodaca' AND capacity = 15;
  IF v_firmas_mty < 1 OR v_firmas_apo < 1 THEN
    RAISE EXCEPTION 'P212 activate precondition: firmas daily 15/15 missing (mty=% apo=%)',
      v_firmas_mty, v_firmas_apo;
  END IF;

  -- ---- agenda_config debe seguir legacy esperado ----
  FOR v_org, v_cfg IN
    SELECT ac.organization_id, ac.config
    FROM public.agenda_config ac
    WHERE ac.kind = 'firmas'
  LOOP
    v_slots := v_cfg->'slots';
    IF v_slots IS NULL OR v_slots <> v_legacy_slots THEN
      RAISE EXCEPTION
        'P212 activate precondition: org % Firmas slots drift (got % want legacy %)',
        v_org, v_slots, v_legacy_slots;
    END IF;

    IF (v_cfg->'locations'->'monterrey') IS NULL
       OR (v_cfg->'locations'->'apodaca') IS NULL THEN
      RAISE EXCEPTION
        'P212 activate precondition: org % missing monterrey/apodaca locations',
        v_org;
    END IF;

    -- No sobrescribir si ya está en target
    IF v_slots = v_target_slots THEN
      RAISE EXCEPTION
        'P212 activate precondition: org % already on target slots — STOP',
        v_org;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.agenda_config WHERE kind = 'firmas') THEN
    RAISE EXCEPTION 'P212 activate precondition: no agenda_config firmas rows';
  END IF;

  -- ---- Apply target config (slots + capacity_by_time POR SEDE) ----
  -- Conserva enabled/timezone/min_lead/allowed_weekdays/locations extras (mty-centro, labels…).
  UPDATE public.agenda_config ac
  SET
    config = jsonb_set(
      jsonb_set(
        jsonb_set(
          ac.config,
          '{slots}',
          v_target_slots,
          true
        ),
        '{locations,monterrey,capacity_by_time}',
        v_target_cbt,
        true
      ),
      '{locations,apodaca,capacity_by_time}',
      v_target_cbt,
      true
    ),
    updated_at = NOW()
  WHERE ac.kind = 'firmas';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated < 1 THEN
    RAISE EXCEPTION 'P212 activate: agenda_config firmas update touched 0 rows';
  END IF;

  -- ---- Enable contract (fecha explícita; NUNCA CURRENT_DATE) ----
  UPDATE public.agenda_firmas_daily_cap_contract
  SET enabled = TRUE,
      effective_from = DATE '2026-09-01',
      enabled_at = NOW(),
      note = 'P212 activated via scripts/p212-activate-firmas.sql effective_from=2026-09-01',
      updated_at = NOW()
  WHERE singleton
    AND enabled = FALSE;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'P212 activate: contract enable UPDATE matched % rows (want 1)', v_updated;
  END IF;

  -- ---- Postconditions ----
  SELECT c.enabled, c.effective_from INTO v_enabled, v_from
  FROM public.agenda_firmas_daily_cap_contract c
  WHERE c.singleton;

  IF v_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'P212 activate postcondition: contract not enabled';
  END IF;
  IF v_from IS DISTINCT FROM DATE '2026-09-01' THEN
    RAISE EXCEPTION 'P212 activate postcondition: effective_from=% want 2026-09-01', v_from;
  END IF;

  FOR v_org, v_cfg IN
    SELECT ac.organization_id, ac.config
    FROM public.agenda_config ac
    WHERE ac.kind = 'firmas'
  LOOP
    IF v_cfg->'slots' IS DISTINCT FROM v_target_slots THEN
      RAISE EXCEPTION 'P212 activate postcondition: org % slots not target', v_org;
    END IF;
    IF v_cfg#>'{locations,monterrey,capacity_by_time}' IS DISTINCT FROM v_target_cbt THEN
      RAISE EXCEPTION 'P212 activate postcondition: org % monterrey capacity_by_time', v_org;
    END IF;
    IF v_cfg#>'{locations,apodaca,capacity_by_time}' IS DISTINCT FROM v_target_cbt THEN
      RAISE EXCEPTION 'P212 activate postcondition: org % apodaca capacity_by_time', v_org;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
