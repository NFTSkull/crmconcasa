-- P212 activation script guards (Fase 3C0).
-- Solo toca org de prueba. Restaura contract OFF al final.
-- Override: SET LOCAL app.p212_activate_as_of.
\set ON_ERROR_STOP on

-- Helpers fuera de TX (DDL)
CREATE OR REPLACE FUNCTION public.__p212_act_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P212 ACT GUARD FAIL: %', p_msg;
  END IF;
END;
$$;

BEGIN;

-- Force INSTALL state
UPDATE public.agenda_firmas_daily_cap_contract
SET enabled = FALSE,
    effective_from = NULL,
    enabled_at = NULL,
    note = 'P212 ACT GUARD: force OFF',
    updated_at = NOW()
WHERE singleton;

INSERT INTO public.organizations (id, slug, name, active)
VALUES ('00000000-0000-4000-8212-00000000ac01', 'p212-act-guard', 'P212 Act Guard', true)
ON CONFLICT (id) DO UPDATE SET active = true;

INSERT INTO public.agenda_daily_capacity_rules (kind, location_id, capacity)
VALUES
  ('biometricos', 'monterrey', 15),
  ('firmas', 'monterrey', 15),
  ('firmas', 'apodaca', 15)
ON CONFLICT (kind, location_id) DO UPDATE
SET capacity = EXCLUDED.capacity, updated_at = NOW();

INSERT INTO public.agenda_config (organization_id, kind, config)
VALUES (
  '00000000-0000-4000-8212-00000000ac01',
  'firmas',
  jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Monterrey',
    'min_lead_hours', 3,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5),
    'slots', jsonb_build_array('08:30','09:00','09:30','10:00','10:30'),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object(
        'enabled', true,
        'label', 'Monterrey',
        'capacity_per_slot', 5,
        'capacity_by_time', jsonb_build_object('08:30',5,'09:00',5,'09:30',6,'10:00',6)
      ),
      'apodaca', jsonb_build_object(
        'enabled', true,
        'label', 'Apodaca',
        'capacity_per_slot', 5,
        'capacity_by_time', jsonb_build_object('08:30',0,'09:00',0,'10:00',5,'10:30',3)
      ),
      'mty-centro', jsonb_build_object('enabled', true, 'capacity_per_slot', 3)
    )
  )
)
ON CONFLICT (organization_id, kind) DO UPDATE
SET config = EXCLUDED.config, updated_at = NOW();

-- A) PRE-SEP gate
DO $$
DECLARE
  v_err TEXT;
  v_cfg JSONB;
  v_en BOOLEAN;
  v_from DATE;
  v_today DATE;
BEGIN
  PERFORM set_config('app.p212_activate_as_of', '2026-08-27', true);
  v_today := COALESCE(
    nullif(current_setting('app.p212_activate_as_of', true), '')::date,
    (now() AT TIME ZONE 'America/Monterrey')::date
  );

  BEGIN
    IF v_today < DATE '2026-09-01' THEN
      RAISE EXCEPTION
        'P212 activation blocked before 2026-09-01 (Monterrey local date=%)',
        v_today;
    END IF;
    RAISE EXCEPTION 'P212 ACT GUARD FAIL: pre-Sep gate did not block';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    IF v_err !~ 'P212 activation blocked before 2026-09-01' THEN
      RAISE EXCEPTION 'P212 ACT GUARD FAIL: unexpected pre-Sep error: %', v_err;
    END IF;
  END;

  SELECT c.enabled, c.effective_from INTO v_en, v_from
  FROM public.agenda_firmas_daily_cap_contract c WHERE c.singleton;
  PERFORM public.__p212_act_assert(v_en IS FALSE, 'pre-Sep contract false');
  PERFORM public.__p212_act_assert(v_from IS NULL, 'pre-Sep effective_from NULL');

  SELECT config INTO v_cfg
  FROM public.agenda_config
  WHERE organization_id = '00000000-0000-4000-8212-00000000ac01' AND kind = 'firmas';
  PERFORM public.__p212_act_assert(
    v_cfg->'slots' = '["08:30","09:00","09:30","10:00","10:30"]'::JSONB,
    'pre-Sep slots still legacy'
  );
END;
$$;

-- B) SEP-01 activate ONLY test org (mirrors scripts/p212-activate-firmas.sql semantics)
DO $$
DECLARE
  v_enabled BOOLEAN;
  v_from DATE;
  v_target_slots JSONB := '["08:00","09:00","10:00"]'::JSONB;
  v_target_cbt JSONB := '{"08:00":5,"09:00":5,"10:00":5}'::JSONB;
  v_cfg JSONB;
  v_today DATE;
  v_org UUID := '00000000-0000-4000-8212-00000000ac01';
BEGIN
  PERFORM set_config('app.p212_activate_as_of', '2026-09-01', true);
  v_today := nullif(current_setting('app.p212_activate_as_of', true), '')::date;
  IF v_today < DATE '2026-09-01' THEN
    RAISE EXCEPTION 'P212 activation blocked before 2026-09-01 (Monterrey local date=%)', v_today;
  END IF;

  SELECT c.enabled INTO v_enabled
  FROM public.agenda_firmas_daily_cap_contract c WHERE c.singleton;
  PERFORM public.__p212_act_assert(v_enabled IS FALSE, 'still OFF before Sep path');

  UPDATE public.agenda_config ac
  SET
    config = jsonb_set(
      jsonb_set(
        jsonb_set(ac.config, '{slots}', v_target_slots, true),
        '{locations,monterrey,capacity_by_time}', v_target_cbt, true
      ),
      '{locations,apodaca,capacity_by_time}', v_target_cbt, true
    ),
    updated_at = NOW()
  WHERE ac.organization_id = v_org AND ac.kind = 'firmas';

  UPDATE public.agenda_firmas_daily_cap_contract
  SET enabled = TRUE,
      effective_from = DATE '2026-09-01',
      enabled_at = NOW(),
      note = 'P212 ACT GUARD sep fixture (rolled back next)',
      updated_at = NOW()
  WHERE singleton AND enabled = FALSE;

  SELECT c.enabled, c.effective_from INTO v_enabled, v_from
  FROM public.agenda_firmas_daily_cap_contract c WHERE c.singleton;
  PERFORM public.__p212_act_assert(v_enabled IS TRUE, 'Sep contract ON');
  PERFORM public.__p212_act_assert(v_from = DATE '2026-09-01', 'Sep effective_from');

  SELECT config INTO v_cfg FROM public.agenda_config WHERE organization_id = v_org AND kind = 'firmas';
  PERFORM public.__p212_act_assert(v_cfg->'slots' = v_target_slots, 'Sep target slots');
  PERFORM public.__p212_act_assert(
    v_cfg#>'{locations,monterrey,capacity_by_time}' = v_target_cbt, 'Sep MTY 5/5/5'
  );
  PERFORM public.__p212_act_assert(
    v_cfg#>'{locations,apodaca,capacity_by_time}' = v_target_cbt, 'Sep APO 5/5/5'
  );
  -- mty-centro preserved (no capacity_by_time forced)
  PERFORM public.__p212_act_assert(
    v_cfg#>'{locations,mty-centro,capacity_per_slot}' = '3'::JSONB, 'mty-centro intact'
  );

  PERFORM public.__p212_act_assert(
    public.agenda_daily_capacity(v_org, 'firmas', DATE '2026-09-15', 'monterrey') = 15,
    'daily MTY 15 ON'
  );
  PERFORM public.__p212_act_assert(
    public.agenda_daily_capacity(v_org, 'firmas', DATE '2026-09-15', 'apodaca') = 15,
    'daily APO 15 ON'
  );
END;
$$;

-- C) Rollback activation effects (contract + test org config)
UPDATE public.agenda_firmas_daily_cap_contract
SET enabled = FALSE,
    effective_from = NULL,
    enabled_at = NULL,
    note = 'P212: default OFF after activate guard test',
    updated_at = NOW()
WHERE singleton;

UPDATE public.agenda_config
SET config = jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Monterrey',
    'min_lead_hours', 3,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5),
    'slots', jsonb_build_array('08:30','09:00','09:30','10:00','10:30'),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object(
        'enabled', true,
        'label', 'Monterrey',
        'capacity_per_slot', 5,
        'capacity_by_time', jsonb_build_object('08:30',5,'09:00',5,'09:30',6,'10:00',6)
      ),
      'apodaca', jsonb_build_object(
        'enabled', true,
        'label', 'Apodaca',
        'capacity_per_slot', 5,
        'capacity_by_time', jsonb_build_object('08:30',0,'09:00',0,'10:00',5,'10:30',3)
      ),
      'mty-centro', jsonb_build_object('enabled', true, 'capacity_per_slot', 3)
    )
  ),
  updated_at = NOW()
WHERE organization_id = '00000000-0000-4000-8212-00000000ac01' AND kind = 'firmas';

DO $$
DECLARE
  v_en BOOLEAN;
  v_from DATE;
  v_cfg JSONB;
BEGIN
  SELECT c.enabled, c.effective_from INTO v_en, v_from
  FROM public.agenda_firmas_daily_cap_contract c WHERE c.singleton;
  PERFORM public.__p212_act_assert(v_en IS FALSE, 'rollback contract false');
  PERFORM public.__p212_act_assert(v_from IS NULL, 'rollback effective_from NULL');

  SELECT config INTO v_cfg
  FROM public.agenda_config
  WHERE organization_id = '00000000-0000-4000-8212-00000000ac01' AND kind = 'firmas';
  PERFORM public.__p212_act_assert(
    v_cfg->'slots' = '["08:30","09:00","09:30","10:00","10:30"]'::JSONB,
    'rollback slots legacy'
  );
END;
$$;

COMMIT;

-- Cleanup test org (durable)
DELETE FROM public.agenda_config
WHERE organization_id = '00000000-0000-4000-8212-00000000ac01';
DELETE FROM public.organizations
WHERE id = '00000000-0000-4000-8212-00000000ac01';
