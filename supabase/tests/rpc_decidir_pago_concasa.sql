-- ConCasa CRM — decidir_pago_concasa (Sí pagó / No pagó)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_decidir_pago_concasa.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_decidir_pago_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'RPC DECIDIR_PAGO TEST FAIL: %', p_msg; END IF; END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_decidir_pago_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_decidir_pago_test_reset_auth()
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
  v_ajeno UUID := '00000000-0000-4000-8002-000000000099';
  v_exp_pagado UUID := '00000000-0000-4000-8166-000000000001';
  v_exp_no UUID := '00000000-0000-4000-8166-000000000002';
  v_exp_etapa10 UUID := '00000000-0000-4000-8166-000000000003';
  v_exp_asesor UUID := '00000000-0000-4000-8166-000000000004';
  v_cita TIMESTAMPTZ := NOW() + INTERVAL '2 days';
  v_result JSONB;
  v_resultado TEXT;
  v_at TIMESTAMPTZ;
  v_by UUID;
  v_etapa INTEGER;
  v_logs INTEGER;
  v_logs2 INTEGER;
  v_monto_before NUMERIC;
  v_monto_after NUMERIC;
  v_docs_before INTEGER;
  v_docs_after INTEGER;
  v_book_before INTEGER;
  v_book_after INTEGER;
  v_asesor_before UUID;
  v_asesor_after UUID;
  v_precal_before TEXT;
  v_precal_after TEXT;
  v_failed BOOLEAN;
BEGIN
  -- Asegurar perfiles mínimos si el seed local los tiene
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, fecha_cita, ciclo_estado
  ) VALUES
    (v_exp_pagado, v_org, v_asesor, 'mejoravit', '81660000001', 'P166 Pagado',
     '5516600001', 'interno', true, NOW(), 11, 'en_proceso', v_cita, 'activo'),
    (v_exp_no, v_org, v_asesor, 'mejoravit', '81660000002', 'P166 No pagó',
     '5516600002', 'interno', true, NOW(), 11, 'en_proceso', v_cita, 'activo'),
    (v_exp_etapa10, v_org, v_asesor, 'mejoravit', '81660000003', 'P166 Etapa10',
     '5516600003', 'interno', true, NOW(), 10, 'en_proceso', v_cita, 'activo'),
    (v_exp_asesor, v_org, v_asesor, 'mejoravit', '81660000004', 'P166 Asesor',
     '5516600004', 'interno', true, NOW(), 11, 'en_proceso', v_cita, 'activo')
  ON CONFLICT (id) DO UPDATE SET
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    ciclo_estado = EXCLUDED.ciclo_estado,
    submitted_to_mesa = true,
    pago_concasa_resultado = NULL,
    pago_concasa_at = NULL,
    pago_concasa_by = NULL,
    deleted_at = NULL,
    updated_at = NOW();

  INSERT INTO public.cliente_datos (expediente_id, organization_id, monto_mejoravit_actualizado, porcentaje_cobro, datos)
  VALUES
    (v_exp_pagado, v_org, 100000, 5.00, '{"precal":"A"}'::jsonb),
    (v_exp_no, v_org, 200000, 5.00, '{"precal":"B"}'::jsonb)
  ON CONFLICT (expediente_id) DO UPDATE SET
    monto_mejoravit_actualizado = EXCLUDED.monto_mejoravit_actualizado,
    porcentaje_cobro = EXCLUDED.porcentaje_cobro,
    datos = EXCLUDED.datos;

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    '00000000-0000-4000-8166-000000000101',
    v_org, v_exp_pagado, 'cliente_ine_frente', 'test/p166/ine.pdf',
    'ine.pdf', 'application/pdf', 100, 'validado', v_asesor, 'asesor'
  ) ON CONFLICT (id) DO UPDATE SET deleted_at = NULL;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org, 'firmas', v_exp_pagado,
    (v_cita AT TIME ZONE 'America/Monterrey')::DATE,
    (v_cita AT TIME ZONE 'America/Monterrey')::TIME,
    'mty-centro', 'booked', v_asesor
  ) ON CONFLICT DO NOTHING;

  SELECT cd.monto_mejoravit_actualizado, cd.datos->>'precal'
  INTO v_monto_before, v_precal_before
  FROM public.cliente_datos cd WHERE cd.expediente_id = v_exp_pagado;

  SELECT COUNT(*)::int INTO v_docs_before
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_pagado AND d.deleted_at IS NULL;

  SELECT COUNT(*)::int INTO v_book_before
  FROM public.agenda_bookings b WHERE b.expediente_id = v_exp_pagado;

  SELECT asesor_id INTO v_asesor_before FROM public.expedientes WHERE id = v_exp_pagado;

  -- 1) Mesa + Firmado + pagado → etapa 12
  PERFORM public.__rpc_decidir_pago_test_set_auth(v_mesa);
  v_result := public.decidir_pago_concasa(v_exp_pagado, 'pagado');
  PERFORM public.__rpc_decidir_pago_test_reset_auth();

  PERFORM public.__rpc_decidir_pago_test_assert((v_result->>'ok')::boolean, '1: ok');
  PERFORM public.__rpc_decidir_pago_test_assert((v_result->>'etapa_actual')::int = 12, '1: etapa 12');
  PERFORM public.__rpc_decidir_pago_test_assert(v_result->>'pago_concasa_resultado' = 'pagado', '1: resultado');

  -- 3/4) persistido + timestamp/actor
  SELECT etapa_actual, pago_concasa_resultado, pago_concasa_at, pago_concasa_by
  INTO v_etapa, v_resultado, v_at, v_by
  FROM public.expedientes WHERE id = v_exp_pagado;
  PERFORM public.__rpc_decidir_pago_test_assert(v_etapa = 12, '3: etapa persistida');
  PERFORM public.__rpc_decidir_pago_test_assert(v_resultado = 'pagado', '3: resultado persistido');
  PERFORM public.__rpc_decidir_pago_test_assert(v_at IS NOT NULL, '4: timestamp');
  PERFORM public.__rpc_decidir_pago_test_assert(v_by = v_mesa, '4: actor');

  -- 5) action_log pagado
  SELECT COUNT(*)::int INTO v_logs
  FROM public.action_log al
  WHERE al.entity_id = v_exp_pagado
    AND al.action = 'expediente.pago_concasa.pagado';
  PERFORM public.__rpc_decidir_pago_test_assert(v_logs = 1, '5: action_log pagado');

  -- 11) doble ejecución no duplica
  PERFORM public.__rpc_decidir_pago_test_set_auth(v_mesa);
  v_result := public.decidir_pago_concasa(v_exp_pagado, 'pagado');
  PERFORM public.__rpc_decidir_pago_test_reset_auth();
  PERFORM public.__rpc_decidir_pago_test_assert((v_result->>'idempotent')::boolean, '11: idempotent');
  SELECT COUNT(*)::int INTO v_logs2
  FROM public.action_log al
  WHERE al.entity_id = v_exp_pagado
    AND al.action = 'expediente.pago_concasa.pagado';
  PERFORM public.__rpc_decidir_pago_test_assert(v_logs2 = 1, '11: sin log duplicado');

  -- no permite cambiar a no_pagado
  v_failed := false;
  BEGIN
    PERFORM public.__rpc_decidir_pago_test_set_auth(v_mesa);
    PERFORM public.decidir_pago_concasa(v_exp_pagado, 'no_pagado');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    PERFORM public.__rpc_decidir_pago_test_reset_auth();
  END;
  PERFORM public.__rpc_decidir_pago_test_assert(v_failed, '11b: bloquea cambio de resultado');

  -- 12/13/14/15) no modifica monto/docs/bookings/asesor/precal
  SELECT cd.monto_mejoravit_actualizado, cd.datos->>'precal'
  INTO v_monto_after, v_precal_after
  FROM public.cliente_datos cd WHERE cd.expediente_id = v_exp_pagado;
  SELECT COUNT(*)::int INTO v_docs_after
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_pagado AND d.deleted_at IS NULL;
  SELECT COUNT(*)::int INTO v_book_after
  FROM public.agenda_bookings b WHERE b.expediente_id = v_exp_pagado;
  SELECT asesor_id INTO v_asesor_after FROM public.expedientes WHERE id = v_exp_pagado;

  PERFORM public.__rpc_decidir_pago_test_assert(v_monto_before IS NOT DISTINCT FROM v_monto_after, '12: monto intacto');
  PERFORM public.__rpc_decidir_pago_test_assert(v_docs_before = v_docs_after, '13: docs intactos');
  PERFORM public.__rpc_decidir_pago_test_assert(v_book_before = v_book_after, '14: bookings intactos');
  PERFORM public.__rpc_decidir_pago_test_assert(v_asesor_before = v_asesor_after, '15: asesor intacto');
  PERFORM public.__rpc_decidir_pago_test_assert(v_precal_before IS NOT DISTINCT FROM v_precal_after, '16: precal intacta');

  -- 2/6) no_pagado
  PERFORM public.__rpc_decidir_pago_test_set_auth(v_mesa_int);
  v_result := public.decidir_pago_concasa(v_exp_no, 'no_pagado');
  PERFORM public.__rpc_decidir_pago_test_reset_auth();
  PERFORM public.__rpc_decidir_pago_test_assert(v_result->>'pago_concasa_resultado' = 'no_pagado', '2: no_pagado');
  PERFORM public.__rpc_decidir_pago_test_assert((v_result->>'etapa_actual')::int = 12, '2: etapa 12');
  SELECT COUNT(*)::int INTO v_logs
  FROM public.action_log al
  WHERE al.entity_id = v_exp_no
    AND al.action = 'expediente.pago_concasa.no_pagado';
  PERFORM public.__rpc_decidir_pago_test_assert(v_logs = 1, '6: action_log no_pagado');

  -- 7) asesor no puede
  v_failed := false;
  BEGIN
    PERFORM public.__rpc_decidir_pago_test_set_auth(v_asesor);
    PERFORM public.decidir_pago_concasa(v_exp_asesor, 'pagado');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    PERFORM public.__rpc_decidir_pago_test_reset_auth();
  END;
  PERFORM public.__rpc_decidir_pago_test_assert(v_failed, '7: asesor bloqueado');

  -- 8) usuario ajeno (sin perfil mesa) — usar asesor de otra org si existe; fallback rol no auth
  -- Usamos un UUID de perfil inexistente / inactivo vía set_auth sin profile → falla
  v_failed := false;
  BEGIN
    PERFORM public.__rpc_decidir_pago_test_set_auth(v_ajeno);
    PERFORM public.decidir_pago_concasa(v_exp_asesor, 'pagado');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    PERFORM public.__rpc_decidir_pago_test_reset_auth();
  END;
  PERFORM public.__rpc_decidir_pago_test_assert(v_failed, '8: ajeno bloqueado');

  -- 9) etapa incorrecta
  v_failed := false;
  BEGIN
    PERFORM public.__rpc_decidir_pago_test_set_auth(v_mesa);
    PERFORM public.decidir_pago_concasa(v_exp_etapa10, 'pagado');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    PERFORM public.__rpc_decidir_pago_test_reset_auth();
  END;
  PERFORM public.__rpc_decidir_pago_test_assert(v_failed, '9: etapa incorrecta');

  -- 10) resultado inválido
  v_failed := false;
  BEGIN
    PERFORM public.__rpc_decidir_pago_test_set_auth(v_mesa);
    -- reset exp_asesor still in 11
    UPDATE public.expedientes SET etapa_actual = 11, pago_concasa_resultado = NULL
    WHERE id = v_exp_asesor;
    PERFORM public.decidir_pago_concasa(v_exp_asesor, 'rechazado');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    PERFORM public.__rpc_decidir_pago_test_reset_auth();
  END;
  PERFORM public.__rpc_decidir_pago_test_assert(v_failed, '10: resultado inválido');

  -- Legado avanzar_etapa_operativa 11→12 sin resultado debe fallar
  v_failed := false;
  BEGIN
    PERFORM public.__rpc_decidir_pago_test_set_auth(v_mesa);
    PERFORM public.avanzar_etapa_operativa(v_exp_asesor);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
    PERFORM public.__rpc_decidir_pago_test_reset_auth();
  END;
  PERFORM public.__rpc_decidir_pago_test_assert(v_failed, 'legado 11_12 bloqueado sin resultado');

  RAISE NOTICE 'RPC decidir_pago_concasa: OK';
END $$;
