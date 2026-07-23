-- ConCasa CRM — P123: capacity_by_time recurrente + precedencia
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_agenda_capacity_by_time_p123.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p123_cbt_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P123 CBT TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p123_cbt_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p123_cbt_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_exp UUID := '00000000-0000-4000-9123-000000000010';
  v_exp2 UUID := '00000000-0000-4000-9123-000000000011';
  v_slot_date DATE := (CURRENT_DATE + 21);
  v_tz TEXT := 'America/Monterrey';
  v_sched_0800 TIMESTAMPTZ;
  v_sched_1000 TIMESTAMPTZ;
  v_cfg JSONB;
  v_meta JSONB;
  v_fail BOOLEAN;
  v_cap INTEGER;
BEGIN
  PERFORM public.__p123_cbt_assert(
    to_regprocedure('public.agenda_location_fallback_capacity(jsonb,text)') IS NOT NULL,
    'helper agenda_location_fallback_capacity (migración 109)'
  );

  v_cap := public.agenda_location_fallback_capacity(
    '{"enabled":true,"capacity_per_slot":15,"capacity_by_time":{"08:00":8,"10:00":5}}'::JSONB,
    '08:00'
  );
  PERFORM public.__p123_cbt_assert(v_cap = 8, 'fallback 08:00 = 8');
  v_cap := public.agenda_location_fallback_capacity(
    '{"enabled":true,"capacity_per_slot":15,"capacity_by_time":{"08:00":8,"10:00":5}}'::JSONB,
    '10:00'
  );
  PERFORM public.__p123_cbt_assert(v_cap = 5, 'fallback 10:00 = 5');
  v_cap := public.agenda_location_fallback_capacity(
    '{"enabled":true,"capacity_per_slot":15,"capacity_by_time":{"08:00":8}}'::JSONB,
    '11:00'
  );
  PERFORM public.__p123_cbt_assert(v_cap = 15, 'sin hora específica usa capacity_per_slot');

  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp, v_exp2);
  DELETE FROM public.agenda_slot_capacities
  WHERE organization_id = v_org AND kind = 'biometricos' AND location_id = 'monterrey'
    AND slot_date = v_slot_date;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '12300000001',
    'Fixture P123 CBT', '5512300001', 'interno', true, NOW(),
    4, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    etapa_actual = 4,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    submitted_to_mesa = true;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '12300000002',
    'Fixture P123 CBT2', '5512300002', 'interno', true, NOW(),
    4, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    etapa_actual = 4,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    submitted_to_mesa = true;

  v_cfg := jsonb_build_object(
    'enabled', true,
    'timezone', v_tz,
    'min_lead_hours', 0,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
    'slots', jsonb_build_array('08:00', '10:00'),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 15,
        'label', 'Monterrey',
        'capacity_by_time', jsonb_build_object('08:00', 8, '10:00', 5)
      ),
      'apodaca', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 10,
        'label', 'Apodaca',
        'capacity_by_time', jsonb_build_object('08:00', 5, '10:00', 10)
      )
    )
  );

  PERFORM public.__p123_cbt_set_auth(v_mesa);
  PERFORM public.upsert_agenda_config_biometricos(v_cfg, v_org);
  PERFORM public.__p123_cbt_reset_auth();

  v_sched_0800 := ((v_slot_date::TEXT || ' 08:00:00')::TIMESTAMP AT TIME ZONE v_tz);
  v_sched_1000 := ((v_slot_date::TEXT || ' 10:00:00')::TIMESTAMP AT TIME ZONE v_tz);

  v_meta := public.agenda_biometricos_assert_slot_available(v_org, v_sched_0800, 'monterrey');
  PERFORM public.__p123_cbt_assert(
    (v_meta->>'capacity_per_slot')::INTEGER = 8,
    'assert 08:00 usa capacity_by_time=8'
  );

  v_meta := public.agenda_biometricos_assert_slot_available(v_org, v_sched_1000, 'monterrey');
  PERFORM public.__p123_cbt_assert(
    (v_meta->>'capacity_per_slot')::INTEGER = 5,
    'assert 10:00 usa capacity_by_time=5'
  );

  -- Excepción por fecha gana
  PERFORM public.__p123_cbt_set_auth(v_mesa);
  PERFORM public.upsert_agenda_slot_capacity(
    'biometricos'::public.booking_kind, 'monterrey', v_slot_date, '10:00'::TIME, 3, true
  );
  PERFORM public.__p123_cbt_reset_auth();

  v_meta := public.agenda_biometricos_assert_slot_available(v_org, v_sched_1000, 'monterrey');
  PERFORM public.__p123_cbt_assert(
    (v_meta->>'capacity_per_slot')::INTEGER = 3,
    'excepción fecha 10:00 = 3 tiene prioridad'
  );
  PERFORM public.__p123_cbt_assert(
    (v_meta->>'capacity_from_override')::BOOLEAN IS TRUE,
    'capacity_from_override true para excepción'
  );

  -- Firmas no comparte config biométricos (kind distinto)
  PERFORM public.__p123_cbt_set_auth(v_mesa);
  PERFORM public.upsert_agenda_config_firmas(
    jsonb_build_object(
      'enabled', true,
      'timezone', v_tz,
      'min_lead_hours', 0,
      'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
      'slots', jsonb_build_array('08:00'),
      'locations', jsonb_build_object(
        'monterrey', jsonb_build_object(
          'enabled', true,
          'capacity_per_slot', 2,
          'label', 'Monterrey',
          'capacity_by_time', jsonb_build_object('08:00', 2)
        ),
        'apodaca', jsonb_build_object(
          'enabled', true,
          'capacity_per_slot', 2,
          'label', 'Apodaca'
        )
      )
    ),
    v_org
  );
  PERFORM public.__p123_cbt_reset_auth();

  v_meta := public.agenda_firmas_assert_slot_available(v_org, v_sched_0800, 'monterrey');
  PERFORM public.__p123_cbt_assert(
    (v_meta->>'capacity_per_slot')::INTEGER = 2,
    'firmas 08:00 = 2 independiente de biométricos 8'
  );

  RAISE NOTICE 'P123 capacity_by_time OK';
END;
$$;

SELECT public.__p123_cbt_reset_auth();
