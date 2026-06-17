-- ConCasa CRM — pruebas P2C-21 backfill agenda_config firmas
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/backfill_agenda_config_firmas.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__backfill_firmas_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'BACKFILL FIRMAS TEST FAIL: %', p_msg; END IF; END; $$;

CREATE OR REPLACE FUNCTION public.__backfill_firmas_test_canonical_config()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT public.agenda_firmas_normalize_config('{}'::jsonb);
$$;

DO $$
DECLARE
  v_org_a UUID := '00000000-0000-4000-8050-000000000001';
  v_org_b UUID := '00000000-0000-4000-8050-000000000002';
  v_org_bio UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_exp UUID := '00000000-0000-4000-9050-000000000010';
  v_custom JSONB := jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Mexico_City',
    'min_lead_hours', 48,
    'allowed_weekdays', jsonb_build_array(1, 2, 3),
    'locations', jsonb_build_object(
      'sede-custom', jsonb_build_object('enabled', true, 'capacity_per_slot', 1)
    ),
    'slots', jsonb_build_array('14:00')
  );
  v_result JSONB;
  v_config JSONB;
  v_count INTEGER;
  v_bio_before JSONB;
  v_bio_after JSONB;
  v_bookings_before BIGINT;
  v_bookings_after BIGINT;
  v_slot_date DATE;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES
    (v_org_a, 'fixture-backfill-firmas-a', 'Fixture Backfill Firmas A', true),
    (v_org_b, 'fixture-backfill-firmas-b', 'Fixture Backfill Firmas B', true)
  ON CONFLICT (id) DO UPDATE SET active = true, updated_at = NOW();

  DELETE FROM public.agenda_config
  WHERE organization_id IN (v_org_a, v_org_b) AND kind = 'firmas';

  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (v_org_b, 'firmas', v_custom)
  ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW();

  -- 1. primera ejecución inserta solo org A
  v_result := public.backfill_agenda_config_firmas();
  PERFORM public.__backfill_firmas_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'inserted')::int >= 1,
    'test 1: primera ejecución inserta'
  );
  PERFORM public.__backfill_firmas_test_assert(
    EXISTS (SELECT 1 FROM public.agenda_config WHERE organization_id = v_org_a AND kind = 'firmas'),
    'test 2: crea config firmas donde faltaba'
  );

  SELECT config INTO v_config FROM public.agenda_config
  WHERE organization_id = v_org_a AND kind = 'firmas';
  PERFORM public.__backfill_firmas_test_assert(
    v_config = public.__backfill_firmas_test_canonical_config(),
    'test 2b: config canónica normalizada'
  );

  -- 3. segunda ejecución no duplica org A
  SELECT COUNT(*) INTO v_count FROM public.agenda_config
  WHERE organization_id = v_org_a AND kind = 'firmas';
  v_result := public.backfill_agenda_config_firmas();
  PERFORM public.__backfill_firmas_test_assert(
    (v_result->>'inserted')::int = 0
      AND (SELECT COUNT(*) FROM public.agenda_config WHERE organization_id = v_org_a AND kind = 'firmas') = v_count,
    'test 3: idempotente sin duplicar'
  );

  -- 4. respeta config firmas existente en org B
  SELECT config INTO v_config FROM public.agenda_config
  WHERE organization_id = v_org_b AND kind = 'firmas';
  PERFORM public.backfill_agenda_config_firmas();
  PERFORM public.__backfill_firmas_test_assert(
    (SELECT config FROM public.agenda_config WHERE organization_id = v_org_b AND kind = 'firmas') = v_config,
    'test 4: no modifica existente'
  );
  PERFORM public.__backfill_firmas_test_assert(
    (v_config->'locations' ? 'sede-custom') AND (v_config->>'timezone') = 'America/Mexico_City',
    'test 4b: conserva personalización existente'
  );

  -- 5. no afecta biométricos (org seed concasa)
  SELECT config INTO v_bio_before FROM public.agenda_config
  WHERE organization_id = v_org_bio AND kind = 'biometricos';
  PERFORM public.backfill_agenda_config_firmas();
  SELECT config INTO v_bio_after FROM public.agenda_config
  WHERE organization_id = v_org_bio AND kind = 'biometricos';
  PERFORM public.__backfill_firmas_test_assert(v_bio_after = v_bio_before, 'test 5: biométricos intactos');

  -- 6. no afecta bookings existentes
  SELECT COUNT(*) INTO v_bookings_before FROM public.agenda_bookings;
  PERFORM public.backfill_agenda_config_firmas();
  SELECT COUNT(*) INTO v_bookings_after FROM public.agenda_bookings;
  PERFORM public.__backfill_firmas_test_assert(v_bookings_after = v_bookings_before, 'test 6: bookings intactos');

  -- 7. config backfill permite assert slot (cupo) para firmas
  v_slot_date := ((NOW() AT TIME ZONE 'America/Monterrey')::date + 10);
  WHILE EXTRACT(ISODOW FROM v_slot_date)::INTEGER NOT IN (1, 2, 3, 4, 5) LOOP
    v_slot_date := v_slot_date + 1;
  END LOOP;
  PERFORM public.__backfill_firmas_test_assert(
    (public.agenda_firmas_assert_slot_available(
      v_org_a,
      (v_slot_date + make_time(10, 0, 0)) AT TIME ZONE 'America/Monterrey',
      'mty-centro'
    )->>'agenda_config_applied')::boolean = true,
    'test 7: cupo validable tras backfill'
  );

  RAISE NOTICE 'backfill_agenda_config_firmas: 7 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__backfill_firmas_test_canonical_config();
DROP FUNCTION IF EXISTS public.__backfill_firmas_test_assert(BOOLEAN, TEXT);
