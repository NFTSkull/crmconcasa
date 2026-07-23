-- ConCasa CRM — P124: cupos explícitos por horario (sin fallback capacity_per_slot)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_agenda_explicit_hourly_p124.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p124_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P124 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_cap INTEGER;
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_slot_date DATE := (CURRENT_DATE + 28);
  v_tz TEXT := 'America/Monterrey';
  v_sched TIMESTAMPTZ;
  v_meta JSONB;
  v_fail BOOLEAN;
BEGIN
  PERFORM public.__p124_assert(
    to_regprocedure('public.agenda_location_explicit_capacity(jsonb,text)') IS NOT NULL,
    'helper agenda_location_explicit_capacity'
  );

  v_cap := public.agenda_location_explicit_capacity(
    '{"capacity_per_slot":15,"capacity_by_time":{"08:00":8}}'::JSONB, '08:00'
  );
  PERFORM public.__p124_assert(v_cap = 8, 'explicit 08:00=8');

  v_cap := public.agenda_location_explicit_capacity(
    '{"capacity_per_slot":15,"capacity_by_time":{"08:00":8}}'::JSONB, '10:00'
  );
  PERFORM public.__p124_assert(v_cap IS NULL, 'sin hora → NULL (no fallback)');

  v_cap := public.agenda_location_fallback_capacity(
    '{"capacity_per_slot":15}'::JSONB, '09:00'
  );
  PERFORM public.__p124_assert(v_cap IS NULL, 'fallback alias tampoco usa capacity_per_slot');

  -- Config con solo capacity_by_time en 08:00
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_mesa::text, true);
  PERFORM public.upsert_agenda_config_biometricos(
    jsonb_build_object(
      'enabled', true,
      'timezone', v_tz,
      'min_lead_hours', 0,
      'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
      'slots', jsonb_build_array('08:00', '10:00'),
      'locations', jsonb_build_object(
        'monterrey', jsonb_build_object(
          'enabled', true,
          'capacity_per_slot', 15,
          'capacity_by_time', jsonb_build_object('08:00', 8, '10:00', 5)
        ),
        'apodaca', jsonb_build_object(
          'enabled', true,
          'capacity_per_slot', 10,
          'capacity_by_time', jsonb_build_object('08:00', 5, '10:00', 10)
        )
      )
    ),
    v_org
  );
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  v_sched := ((v_slot_date::TEXT || ' 08:00:00')::TIMESTAMP AT TIME ZONE v_tz);
  v_meta := public.agenda_biometricos_assert_slot_available(v_org, v_sched, 'monterrey');
  PERFORM public.__p124_assert((v_meta->>'capacity_per_slot')::INTEGER = 8, 'assert usa 8');

  -- Sin capacity_by_time para una hora inventada en slots: forzar config con solo 08:00 en map
  -- y slot 11:00 en lista sin cbt → assert debe fallar
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_mesa::text, true);
  PERFORM public.upsert_agenda_config_biometricos(
    jsonb_build_object(
      'enabled', true,
      'timezone', v_tz,
      'min_lead_hours', 0,
      'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
      'slots', jsonb_build_array('08:00', '11:00'),
      'locations', jsonb_build_object(
        'monterrey', jsonb_build_object(
          'enabled', true,
          'capacity_per_slot', 99,
          'capacity_by_time', jsonb_build_object('08:00', 8)
        ),
        'apodaca', jsonb_build_object(
          'enabled', true,
          'capacity_per_slot', 99,
          'capacity_by_time', jsonb_build_object('08:00', 5, '11:00', 3)
        )
      )
    ),
    v_org
  );
  PERFORM set_config('role', 'postgres', true);

  v_sched := ((v_slot_date::TEXT || ' 11:00:00')::TIMESTAMP AT TIME ZONE v_tz);
  BEGIN
    PERFORM public.agenda_biometricos_assert_slot_available(v_org, v_sched, 'monterrey');
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := SQLERRM ILIKE '%cupo no configurado%';
  END;
  PERFORM public.__p124_assert(v_fail, '11:00 monterrey sin cbt → cupo no configurado (ignora cps=99)');

  RAISE NOTICE 'P124 explicit hourly OK';
END;
$$;
