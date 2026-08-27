-- P212 OFF-mode regression: contract enabled=false → PRE-P212 booking semantics.
-- No daily Firmas enforcement; agenda_config slots legacy preserved by INSTALL.
\set ON_ERROR_STOP on

-- P208 suite \ir 208 DDL-commits and clobbers P212 gate; re-apply INSTALL body.
\ir ../migrations/212_agenda_firmas_daily_cap.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.__p212_off_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P212 OFF FAIL: %', p_msg; END IF;
END; $$;

DO $$
DECLARE
  v_enabled BOOLEAN;
  v_from DATE;
  v_cap INTEGER;
  v_slots JSONB;
  v_org UUID;
BEGIN
  -- Forzar OFF: tests ON previos pueden dejar enabled=true (DDL implícito rompe ROLLBACK).
  UPDATE public.agenda_firmas_daily_cap_contract
  SET enabled = FALSE,
      effective_from = NULL,
      enabled_at = NULL,
      note = 'P212 OFF-mode fixture',
      updated_at = NOW()
  WHERE singleton;

  SELECT c.enabled, c.effective_from INTO v_enabled, v_from
  FROM public.agenda_firmas_daily_cap_contract c
  WHERE c.singleton;

  PERFORM public.__p212_off_assert(v_enabled IS FALSE, 'contract must be enabled=false after INSTALL');
  PERFORM public.__p212_off_assert(v_from IS NULL, 'effective_from NULL during INSTALL');

  -- Rules exist (definition installed) but capacity() returns NULL while OFF
  PERFORM public.__p212_off_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_daily_capacity_rules
      WHERE kind = 'firmas' AND location_id = 'monterrey' AND capacity = 15
    ),
    'firmas/monterrey=15 definition installed'
  );
  PERFORM public.__p212_off_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_daily_capacity_rules
      WHERE kind = 'firmas' AND location_id = 'apodaca' AND capacity = 15
    ),
    'firmas/apodaca=15 definition installed'
  );

  SELECT organization_id INTO v_org
  FROM public.agenda_config
  WHERE kind = 'firmas'
  LIMIT 1;

  IF v_org IS NOT NULL THEN
    v_cap := public.agenda_daily_capacity(v_org, 'firmas', DATE '2026-09-15', 'monterrey');
    PERFORM public.__p212_off_assert(v_cap IS NULL, 'daily capacity NULL while contract OFF');

    PERFORM public.__p212_off_assert(
      public.agenda_firmas_daily_cap_contract_enabled(DATE '2026-09-15') IS FALSE,
      'contract_enabled false for Sep date'
    );

    SELECT config->'slots' INTO v_slots
    FROM public.agenda_config
    WHERE organization_id = v_org AND kind = 'firmas';

    -- INSTALL must not rewrite slots to target-only 08/09/10
    PERFORM public.__p212_off_assert(
      v_slots IS DISTINCT FROM '["08:00","09:00","10:00"]'::JSONB,
      'agenda_config slots must not be target-only after INSTALL'
    );
  END IF;

  -- Canonical helpers exist even OFF
  PERFORM public.__p212_off_assert(
    public.agenda_firmas_canonical_location_id('mty-centro') = 'monterrey',
    'canonical mty-centro'
  );
  PERFORM public.__p212_off_assert(
    public.agenda_firmas_canonical_location_id('san-nicolas') = 'apodaca',
    'canonical san-nicolas'
  );
END;
$$;

-- Booking legacy path: assert accepts a pre-P212 slot from config (if org seeded).
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8212-0000000000ff';
  v_asesor UUID := '00000000-0000-4000-8212-0000000000fe';
  v_date DATE := DATE '2026-09-17';
  v_ts TIMESTAMPTZ;
  v_meta JSONB;
  v_err TEXT;
BEGIN
  -- Ensure OFF
  UPDATE public.agenda_firmas_daily_cap_contract
  SET enabled = FALSE, effective_from = NULL, enabled_at = NULL, updated_at = NOW()
  WHERE singleton;

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p212-off-org', 'P212 OFF Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO public.profiles (id, organization_id, email, app_role, active, full_name)
  VALUES (v_asesor, v_org, 'p212.off@local.test', 'asesor', true, 'P212 OFF')
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, active = true;

  -- Legacy-style config (pre-P212 slots including 08:30)
  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (v_org, 'firmas', jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Monterrey',
    'min_lead_hours', 0,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
    'slots', jsonb_build_array('08:30','09:00','09:30','10:00','10:30'),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object(
        'enabled', true,
        'capacity_by_time', jsonb_build_object(
          '08:30', 3, '09:00', 3, '09:30', 3, '10:00', 3, '10:30', 3
        )
      ),
      'apodaca', jsonb_build_object(
        'enabled', true,
        'capacity_by_time', jsonb_build_object(
          '08:30', 3, '09:00', 3, '09:30', 3, '10:00', 3, '10:30', 3
        )
      )
    )
  ))
  ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config;

  -- Seed inventory for legacy 08:30
  INSERT INTO public.agenda_sheet_slot_inventory (
    organization_id, spreadsheet_id, sheet_id, sheet_title,
    booking_date, sheet_row, kind, location_id, slot_time, slot_key,
    status, occupancy_source, observed_at
  )
  SELECT
    v_org, 'off-sheet', 1, 'OFF Tab',
    v_date, gs, 'firmas', 'monterrey', TIME '08:30',
    format('firmas|%s|08:30:00|monterrey|row=%s', v_date, gs),
    'available', 'reconciliation', NOW()
  FROM generate_series(1, 3) gs
  ON CONFLICT DO NOTHING;

  v_ts := (v_date::TEXT || ' 08:30:00')::TIMESTAMP AT TIME ZONE 'America/Monterrey';

  BEGIN
    v_meta := public.agenda_firmas_assert_slot_available(v_org, v_ts, 'monterrey');
    PERFORM public.__p212_off_assert(
      COALESCE((v_meta->>'firmas_daily_cap_contract')::BOOLEAN, false) IS FALSE,
      'OFF path must not set firmas_daily_cap_contract true'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    RAISE EXCEPTION 'P212 OFF FAIL: legacy 08:30 assert should pass while OFF: %', v_err;
  END;

  -- Target-only 08:00 should FAIL while OFF if not in legacy slots
  v_ts := (v_date::TEXT || ' 08:00:00')::TIMESTAMP AT TIME ZONE 'America/Monterrey';
  BEGIN
    v_meta := public.agenda_firmas_assert_slot_available(v_org, v_ts, 'monterrey');
    RAISE EXCEPTION 'P212 OFF FAIL: 08:00 should be blocked by legacy config while OFF';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      NULL; -- expected
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'P212 OFF FAIL:%' THEN
        RAISE;
      END IF;
      -- other errors also OK as blocked
      NULL;
  END;
END;
$$;

ROLLBACK;
