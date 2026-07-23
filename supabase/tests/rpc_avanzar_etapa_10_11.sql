-- ConCasa CRM — P117: avanzar_etapa_operativa 10→11 (Firmado)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_avanzar_etapa_10_11.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_1011_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'RPC AVANZAR 1011 TEST FAIL: %', p_msg; END IF; END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_1011_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_1011_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_1011_test_slot_ts(
  p_iso_dow INTEGER, p_slot TEXT, p_min_days INTEGER DEFAULT 3, p_tz TEXT DEFAULT 'America/Monterrey'
)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE AS $$
DECLARE v_date DATE; v_parts TEXT[]; v_hour INTEGER; v_minute INTEGER;
BEGIN
  v_date := ((NOW() AT TIME ZONE p_tz)::DATE + p_min_days);
  WHILE EXTRACT(ISODOW FROM v_date)::INTEGER <> p_iso_dow LOOP v_date := v_date + 1; END LOOP;
  v_parts := regexp_split_to_array(p_slot, ':');
  v_hour := v_parts[1]::INTEGER; v_minute := v_parts[2]::INTEGER;
  RETURN (v_date + make_time(v_hour, v_minute, 0)) AT TIME ZONE p_tz;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_1011_test_firmas_config()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'enabled', true, 'timezone', 'America/Monterrey', 'min_lead_hours', 24,
    'allowed_weekdays', jsonb_build_array(1, 2, 3, 4, 5),
    'locations', jsonb_build_object(
      'mty-centro', jsonb_build_object('enabled', true, 'capacity_per_slot', 3)
    ),
    'slots', jsonb_build_array('09:00', '10:00', '11:00', '12:00', '16:00')
  );
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000002';
  v_exp UUID := '00000000-0000-4000-8117-000000000101';
  v_exp_no_book UUID := '00000000-0000-4000-8117-000000000102';
  v_exp_etapa9 UUID := '00000000-0000-4000-8117-000000000103';
  v_exp_cancel UUID := '00000000-0000-4000-8117-000000000104';
  v_cita TIMESTAMPTZ;
  v_booking_date DATE;
  v_booking_time TIME;
  v_result JSONB;
  v_fecha_before TIMESTAMPTZ;
  v_booking_id UUID;
BEGIN
  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (v_org, 'firmas', public.__rpc_avanzar_1011_test_firmas_config())
  ON CONFLICT (organization_id, kind) DO UPDATE
    SET config = EXCLUDED.config, updated_at = NOW();

  v_cita := public.__rpc_avanzar_1011_test_slot_ts(1, '10:00');
  v_booking_date := (v_cita AT TIME ZONE 'America/Monterrey')::DATE;
  v_booking_time := (v_cita AT TIME ZONE 'America/Monterrey')::TIME;

  -- fixtures
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, fecha_cita, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '81171000011', 'P117 Firmado OK',
     '5511111111', 'interno', true, NOW(), 10, 'en_proceso', v_cita, 'activo'),
    (v_exp_no_book, v_org, v_asesor, 'mejoravit', '81171000012', 'P117 Sin booking',
     '5511111112', 'interno', true, NOW(), 10, 'en_proceso', v_cita, 'activo'),
    (v_exp_etapa9, v_org, v_asesor, 'mejoravit', '81171000013', 'P117 Etapa9',
     '5511111113', 'interno', true, NOW(), 9, 'en_proceso', v_cita, 'activo'),
    (v_exp_cancel, v_org, v_asesor, 'mejoravit', '81171000014', 'P117 Cancel',
     '5511111114', 'interno', true, NOW(), 10, 'en_proceso', v_cita, 'cancelado')
  ON CONFLICT (id) DO UPDATE SET
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    fecha_cita = EXCLUDED.fecha_cita,
    ciclo_estado = EXCLUDED.ciclo_estado,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    deleted_at = NULL,
    updated_at = NOW();

  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp, v_exp_no_book, v_exp_etapa9, v_exp_cancel);

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org, 'firmas', v_exp, v_booking_date, v_booking_time,
    'mty-centro', 'booked', v_asesor
  ) RETURNING id INTO v_booking_id;

  -- 1. Mesa avanza 10→11
  PERFORM public.__rpc_avanzar_1011_test_set_auth(v_mesa);
  SELECT public.avanzar_etapa_operativa(v_exp) INTO v_result;
  PERFORM public.__rpc_avanzar_1011_test_reset_auth();
  PERFORM public.__rpc_avanzar_1011_test_assert((v_result->>'ok')::boolean, '1: ok');
  PERFORM public.__rpc_avanzar_1011_test_assert((v_result->>'etapa_actual')::int = 11, '1: etapa 11');
  PERFORM public.__rpc_avanzar_1011_test_assert(v_result->>'transition' = '10_11', '1: transition');

  SELECT fecha_cita INTO v_fecha_before FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__rpc_avanzar_1011_test_assert(v_fecha_before IS NOT NULL, '1: conserva fecha_cita');
  PERFORM public.__rpc_avanzar_1011_test_assert(
    EXISTS (SELECT 1 FROM public.agenda_bookings b WHERE b.id = v_booking_id AND b.status = 'booked'),
    '1: conserva booking'
  );

  -- 2. sin booking bloquea
  PERFORM public.__rpc_avanzar_1011_test_set_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_no_book);
    RAISE EXCEPTION 'RPC AVANZAR 1011 TEST FAIL: 2 debía fallar sin booking';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_1011_test_assert(
      SQLERRM ILIKE '%booking%',
      '2: error booking'
    );
  END;
  PERFORM public.__rpc_avanzar_1011_test_reset_auth();

  -- 3. etapa 9 no permite 10→11
  PERFORM public.__rpc_avanzar_1011_test_set_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_etapa9);
    -- 9→10 podría pasar si tiene booking; este fixture no tiene booking firmas
    RAISE EXCEPTION 'RPC AVANZAR 1011 TEST FAIL: 3 debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_1011_test_assert(
      SQLERRM ILIKE '%booking%' OR SQLERRM ILIKE '%fecha%' OR SQLERRM ILIKE '%no permitida%',
      '3: bloquea desde etapa 9 sin gates 9→10'
    );
  END;
  PERFORM public.__rpc_avanzar_1011_test_reset_auth();

  -- 4. asesor no autorizado
  UPDATE public.expedientes SET etapa_actual = 10 WHERE id = v_exp;
  DELETE FROM public.agenda_bookings WHERE expediente_id = v_exp AND kind = 'firmas';
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org, 'firmas', v_exp, v_booking_date, v_booking_time,
    'mty-centro', 'booked', v_asesor
  );

  PERFORM public.__rpc_avanzar_1011_test_set_auth(v_asesor);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp);
    RAISE EXCEPTION 'RPC AVANZAR 1011 TEST FAIL: 4 asesor no debía avanzar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_1011_test_assert(
      SQLERRM ILIKE '%no autorizado%' OR SQLERRM ILIKE '%42501%' OR SQLSTATE = '42501',
      '4: asesor bloqueado'
    );
  END;
  PERFORM public.__rpc_avanzar_1011_test_reset_auth();

  -- 5. cancelado bloquea
  PERFORM public.__rpc_avanzar_1011_test_set_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_cancel);
    RAISE EXCEPTION 'RPC AVANZAR 1011 TEST FAIL: 5 cancelado debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_1011_test_assert(
      SQLERRM ILIKE '%ciclo%' OR SQLERRM ILIKE '%activo%',
      '5: cancelado bloqueado'
    );
  END;
  PERFORM public.__rpc_avanzar_1011_test_reset_auth();

  RAISE NOTICE 'RPC avanzar_etapa_operativa 10→11: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_avanzar_1011_test_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_1011_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_1011_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_avanzar_1011_test_slot_ts(INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_1011_test_firmas_config();
