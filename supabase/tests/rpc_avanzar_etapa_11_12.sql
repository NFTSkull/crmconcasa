-- ConCasa CRM — P119.4: avanzar_etapa_operativa 11→12 (Pago a ConCasa)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_avanzar_etapa_11_12.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_1112_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'RPC AVANZAR 1112 TEST FAIL: %', p_msg; END IF; END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_1112_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_1112_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';
  v_exp UUID := '00000000-0000-4000-8119-000000000401';
  v_exp_etapa10 UUID := '00000000-0000-4000-8119-000000000402';
  v_exp_rechaz UUID := '00000000-0000-4000-8119-000000000403';
  v_exp_cancel UUID := '00000000-0000-4000-8119-000000000404';
  v_exp_roles UUID := '00000000-0000-4000-8119-000000000405';
  v_cita TIMESTAMPTZ := NOW() + INTERVAL '3 days';
  v_result JSONB;
  v_fecha_before TIMESTAMPTZ;
  v_fecha_after TIMESTAMPTZ;
  v_booking_id UUID;
  v_booking_status TEXT;
  v_docs_before INTEGER;
  v_docs_after INTEGER;
  v_monto_before NUMERIC;
  v_monto_after NUMERIC;
  v_logs_before INTEGER;
  v_logs_after INTEGER;
  v_etapa INTEGER;
  v_sub TEXT;
BEGIN
  -- fixtures
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, fecha_cita, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '81194000011', 'P119.4 Pago OK',
     '5519400011', 'interno', true, NOW(), 11, 'en_proceso', v_cita, 'activo'),
    (v_exp_etapa10, v_org, v_asesor, 'mejoravit', '81194000012', 'P119.4 Etapa10',
     '5519400012', 'interno', true, NOW(), 10, 'en_proceso', v_cita, 'activo'),
    (v_exp_rechaz, v_org, v_asesor, 'mejoravit', '81194000013', 'P119.4 Rechazado',
     '5519400013', 'interno', true, NOW(), 11, 'rechazado', v_cita, 'activo'),
    (v_exp_cancel, v_org, v_asesor, 'mejoravit', '81194000014', 'P119.4 Cancel',
     '5519400014', 'interno', true, NOW(), 11, 'en_proceso', v_cita, 'cancelado'),
    (v_exp_roles, v_org, v_asesor, 'mejoravit', '81194000015', 'P119.4 Roles',
     '5519400015', 'interno', true, NOW(), 11, 'en_proceso', v_cita, 'activo')
  ON CONFLICT (id) DO UPDATE SET
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    fecha_cita = EXCLUDED.fecha_cita,
    ciclo_estado = EXCLUDED.ciclo_estado,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    deleted_at = NULL,
    updated_at = NOW();

  DELETE FROM public.agenda_bookings
  WHERE expediente_id IN (v_exp, v_exp_etapa10, v_exp_rechaz, v_exp_cancel, v_exp_roles);

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org, 'firmas', v_exp,
    (v_cita AT TIME ZONE 'America/Monterrey')::DATE,
    (v_cita AT TIME ZONE 'America/Monterrey')::TIME,
    'mty-centro', 'booked', v_asesor
  ) RETURNING id INTO v_booking_id;

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes,
    estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    '00000000-0000-4000-8119-000000000501',
    v_org, v_exp, 'cliente_ine_frente', 'test/p1194/ine.pdf',
    'ine.pdf', 'application/pdf', 100,
    'validado', v_asesor, 'asesor'
  ) ON CONFLICT (id) DO UPDATE SET
    deleted_at = NULL,
    estatus_revision = 'validado';

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, decided_by
  ) VALUES (
    v_exp, v_org, 'aprobado', 12345.67, v_mesa
  ) ON CONFLICT (expediente_id) DO UPDATE SET
    monto_aprobado = EXCLUDED.monto_aprobado,
    decision = EXCLUDED.decision,
    decided_by = EXCLUDED.decided_by,
    updated_at = NOW();

  SELECT fecha_cita INTO v_fecha_before FROM public.expedientes WHERE id = v_exp;
  SELECT COUNT(*)::int INTO v_docs_before
  FROM public.expediente_documentos WHERE expediente_id = v_exp AND deleted_at IS NULL;
  SELECT monto_aprobado INTO v_monto_before
  FROM public.editor_decisions WHERE expediente_id = v_exp;
  SELECT COUNT(*)::int INTO v_logs_before
  FROM public.action_log
  WHERE entity_id = v_exp
    AND action = 'expediente.avanzar_etapa_operativa'
    AND (payload->>'transition') = '11_12';

  -- 1. Mesa admin avanza 11→12
  PERFORM public.__rpc_avanzar_1112_test_set_auth(v_mesa);
  SELECT public.avanzar_etapa_operativa(v_exp) INTO v_result;
  PERFORM public.__rpc_avanzar_1112_test_reset_auth();
  PERFORM public.__rpc_avanzar_1112_test_assert((v_result->>'ok')::boolean, '1: ok');
  PERFORM public.__rpc_avanzar_1112_test_assert((v_result->>'etapa_anterior')::int = 11, '1: etapa_anterior');
  PERFORM public.__rpc_avanzar_1112_test_assert((v_result->>'etapa_actual')::int = 12, '1: etapa 12');
  PERFORM public.__rpc_avanzar_1112_test_assert(v_result->>'transition' = '11_12', '1: transition');
  PERFORM public.__rpc_avanzar_1112_test_assert(v_result->>'subestado' = 'en_proceso', '1: subestado');

  SELECT etapa_actual, subestado, fecha_cita
  INTO v_etapa, v_sub, v_fecha_after
  FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__rpc_avanzar_1112_test_assert(v_etapa = 12, '1b: persist etapa 12');
  PERFORM public.__rpc_avanzar_1112_test_assert(v_sub = 'en_proceso', '1b: persist subestado');
  PERFORM public.__rpc_avanzar_1112_test_assert(v_fecha_after IS NOT DISTINCT FROM v_fecha_before, '1b: conserva fecha_cita');

  SELECT status INTO v_booking_status FROM public.agenda_bookings WHERE id = v_booking_id;
  PERFORM public.__rpc_avanzar_1112_test_assert(v_booking_status = 'booked', '1b: conserva booking');

  SELECT COUNT(*)::int INTO v_docs_after
  FROM public.expediente_documentos WHERE expediente_id = v_exp AND deleted_at IS NULL;
  PERFORM public.__rpc_avanzar_1112_test_assert(v_docs_after = v_docs_before, '1b: conserva documentos');

  SELECT monto_aprobado INTO v_monto_after
  FROM public.editor_decisions WHERE expediente_id = v_exp;
  PERFORM public.__rpc_avanzar_1112_test_assert(v_monto_after IS NOT DISTINCT FROM v_monto_before, '1b: conserva monto');

  SELECT COUNT(*)::int INTO v_logs_after
  FROM public.action_log
  WHERE entity_id = v_exp
    AND action = 'expediente.avanzar_etapa_operativa'
    AND (payload->>'transition') = '11_12';
  PERFORM public.__rpc_avanzar_1112_test_assert(v_logs_after = v_logs_before + 1, '1b: action_log');

  -- 2. Doble ejecución: no duplica efectos
  PERFORM public.__rpc_avanzar_1112_test_set_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp);
    RAISE EXCEPTION 'RPC AVANZAR 1112 TEST FAIL: 2 debía fallar en etapa 12';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_1112_test_assert(
      SQLERRM ILIKE '%no permitida%' OR SQLERRM ILIKE '%transición%',
      '2: bloquea desde 12'
    );
  END;
  PERFORM public.__rpc_avanzar_1112_test_reset_auth();

  SELECT COUNT(*)::int INTO v_logs_after
  FROM public.action_log
  WHERE entity_id = v_exp
    AND action = 'expediente.avanzar_etapa_operativa'
    AND (payload->>'transition') = '11_12';
  PERFORM public.__rpc_avanzar_1112_test_assert(v_logs_after = v_logs_before + 1, '2b: sin log duplicado');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__rpc_avanzar_1112_test_assert(v_etapa = 12, '2b: sigue en 12');

  -- 3. Otras etapas no pueden llamar 11→12 (etapa 10)
  PERFORM public.__rpc_avanzar_1112_test_set_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_etapa10);
    -- 10→11 podría pasar si tiene booking; fixture sin booking firmas → falla
    RAISE EXCEPTION 'RPC AVANZAR 1112 TEST FAIL: 3 debía fallar desde etapa 10 sin gates 10→11';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_1112_test_assert(
      SQLERRM ILIKE '%booking%' OR SQLERRM ILIKE '%fecha%' OR SQLERRM ILIKE '%no permitida%',
      '3: bloquea etapa 10 sin gates firmado'
    );
  END;
  PERFORM public.__rpc_avanzar_1112_test_reset_auth();
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp_etapa10;
  PERFORM public.__rpc_avanzar_1112_test_assert(v_etapa = 10, '3b: rollback/no muta etapa 10');

  -- 4. Asesor bloqueado
  UPDATE public.expedientes SET etapa_actual = 11, subestado = 'en_proceso', ciclo_estado = 'activo'
  WHERE id = v_exp_roles;

  PERFORM public.__rpc_avanzar_1112_test_set_auth(v_asesor);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_roles);
    RAISE EXCEPTION 'RPC AVANZAR 1112 TEST FAIL: 4 asesor no debía avanzar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_1112_test_assert(
      SQLERRM ILIKE '%no autorizado%' OR SQLERRM ILIKE '%42501%' OR SQLSTATE = '42501',
      '4: asesor bloqueado'
    );
  END;
  PERFORM public.__rpc_avanzar_1112_test_reset_auth();
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp_roles;
  PERFORM public.__rpc_avanzar_1112_test_assert(v_etapa = 11, '4b: no muta con asesor');

  -- 5. Roles Mesa autorizados (interno / externo / super)
  PERFORM public.__rpc_avanzar_1112_test_set_auth(v_mesa_int);
  SELECT public.avanzar_etapa_operativa(v_exp_roles) INTO v_result;
  PERFORM public.__rpc_avanzar_1112_test_reset_auth();
  PERFORM public.__rpc_avanzar_1112_test_assert(v_result->>'transition' = '11_12', '5a: mesa_interno');

  UPDATE public.expedientes
  SET etapa_actual = 11, subestado = 'en_proceso', origen_mesa = 'externo'
  WHERE id = v_exp_roles;
  PERFORM public.__rpc_avanzar_1112_test_set_auth(v_mesa_ext);
  SELECT public.avanzar_etapa_operativa(v_exp_roles) INTO v_result;
  PERFORM public.__rpc_avanzar_1112_test_reset_auth();
  PERFORM public.__rpc_avanzar_1112_test_assert(v_result->>'transition' = '11_12', '5b: mesa_externo');

  UPDATE public.expedientes
  SET etapa_actual = 11, subestado = 'en_proceso', origen_mesa = 'interno'
  WHERE id = v_exp_roles;
  PERFORM public.__rpc_avanzar_1112_test_set_auth(v_super);
  SELECT public.avanzar_etapa_operativa(v_exp_roles) INTO v_result;
  PERFORM public.__rpc_avanzar_1112_test_reset_auth();
  PERFORM public.__rpc_avanzar_1112_test_assert(v_result->>'transition' = '11_12', '5c: super_admin');

  -- 6. Rechazado pendiente bloqueado
  PERFORM public.__rpc_avanzar_1112_test_set_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_rechaz);
    RAISE EXCEPTION 'RPC AVANZAR 1112 TEST FAIL: 6 rechazado debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_1112_test_assert(
      SQLERRM ILIKE '%subestado%' OR SQLERRM ILIKE '%en_proceso%',
      '6: rechazado bloqueado'
    );
  END;
  PERFORM public.__rpc_avanzar_1112_test_reset_auth();
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp_rechaz;
  PERFORM public.__rpc_avanzar_1112_test_assert(v_etapa = 11, '6b: no muta rechazado');

  -- 7. Cancelado terminal bloqueado
  PERFORM public.__rpc_avanzar_1112_test_set_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_cancel);
    RAISE EXCEPTION 'RPC AVANZAR 1112 TEST FAIL: 7 cancelado debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_avanzar_1112_test_assert(
      SQLERRM ILIKE '%ciclo%' OR SQLERRM ILIKE '%activo%',
      '7: cancelado bloqueado'
    );
  END;
  PERFORM public.__rpc_avanzar_1112_test_reset_auth();
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp_cancel;
  PERFORM public.__rpc_avanzar_1112_test_assert(v_etapa = 11, '7b: no muta cancelado');

  RAISE NOTICE 'RPC avanzar_etapa_operativa 11→12: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_avanzar_1112_test_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_1112_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_1112_test_reset_auth();
