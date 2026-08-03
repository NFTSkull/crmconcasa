-- ConCasa CRM — pruebas RPC asesor_enviar_reingreso_a_mesa (mig. 142 + hotfix 143)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_asesor_enviar_reingreso_a_mesa.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_arm_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC ARM TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_arm_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_arm_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_arm_call(p_user UUID, p_exp UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_arm_auth(p_user);
  SELECT public.asesor_enviar_reingreso_a_mesa(p_exp) INTO v_result;
  PERFORM public.__rpc_arm_reset();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_arm_expect_fail(
  p_user UUID, p_exp UUID, p_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__rpc_arm_auth(p_user);
  BEGIN
    PERFORM public.asesor_enviar_reingreso_a_mesa(p_exp);
    PERFORM public.__rpc_arm_reset();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_arm_reset();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC ARM TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9143-000000000001';
  v_asesor UUID := '00000000-0000-4000-9143-000000000011';
  v_asesor2 UUID := '00000000-0000-4000-9143-000000000012';
  v_editor UUID := '00000000-0000-4000-9143-000000000013';
  v_exp UUID := '00000000-0000-4000-9143-000000000021';
  v_exp_new UUID := '00000000-0000-4000-9143-000000000022';
  v_exp_empty UUID := '00000000-0000-4000-9143-000000000023';
  v_exp_cancel UUID := '00000000-0000-4000-9143-000000000024';
  v_result JSONB;
  v_count INTEGER;
  v_id UUID;
  v_etapa SMALLINT;
  v_sub public.operativo_subestado;
  v_log BIGINT;
  v_docs_before BIGINT;
  v_docs_after BIGINT;
  v_nss_count INTEGER;
  v_tipo TEXT;
  v_citas_before BIGINT;
  v_citas_after BIGINT;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'arm-reingreso-143-org', 'ARM Reingreso 143 Org', true)
  ON CONFLICT (slug) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'arm143-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor2, 'authenticated', 'authenticated', 'arm143-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_editor, 'authenticated', 'authenticated', 'arm143-editor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_asesor, v_org, 'arm143-asesor@test.local', 'Asesor ARM143', 'asesor', 'interno', true),
    (v_asesor2, v_org, 'arm143-asesor2@test.local', 'Asesor2 ARM143', 'asesor', 'interno', true),
    (v_editor, v_org, 'arm143-editor@test.local', 'Editor ARM143', 'editor', NULL, true)
  ON CONFLICT (id) DO UPDATE SET active = true, organization_id = EXCLUDED.organization_id;

  -- Expediente ya enviado etapa 4
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91430000021', 'Cliente ARM143', '5511111111',
    'interno', true, NOW() - INTERVAL '2 days', 4, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    submitted_to_mesa = true,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    etapa_actual = 4,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    reingreso_manual_count = 0,
    deleted_at = NULL;

  -- Nunca enviado
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_new, v_org, v_asesor, 'mejoravit', '91430000022', 'Cliente Nuevo', '5511111112',
    'interno', false, 1, 'pendiente', 'activo'
  ) ON CONFLICT (id) DO UPDATE SET
    submitted_to_mesa = false,
    fecha_envio_mesa = NULL,
    reingreso_manual_count = 0,
    deleted_at = NULL,
    ciclo_estado = 'activo';

  -- Sin monto / sin docs / sin datos (etapa 8)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_empty, v_org, v_asesor, 'mejoravit', '91430000023', 'Cliente Vacío', '5511111113',
    'interno', true, NOW() - INTERVAL '1 day', 8, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO UPDATE SET
    etapa_actual = 8,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    reingreso_manual_count = 0,
    deleted_at = NULL;

  -- Cancelado
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_cancel, v_org, v_asesor, 'mejoravit', '91430000024', 'Cliente Cancel', '5511111114',
    'interno', true, NOW() - INTERVAL '3 days', 3, 'en_proceso', 'cancelado'
  ) ON CONFLICT (id) DO UPDATE SET ciclo_estado = 'cancelado', deleted_at = NULL;

  -- Solo v_exp tiene docs + decisión + cliente (para conservar docs)
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (v_exp, v_org, 'aprobado', 200000)
  ON CONFLICT (expediente_id) DO UPDATE SET monto_aprobado = 200000, decision = 'aprobado';

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, estado, porcentaje_cobro, monto_calculado, metodo_pago, datos
  ) VALUES
    (v_exp, v_org, 'completo', 10, 20000, 'transferencia', '{"rfc":"XAXX010101000"}'::jsonb)
  ON CONFLICT (expediente_id) DO UPDATE SET
    estado = 'completo',
    porcentaje_cobro = 10,
    monto_calculado = 20000,
    metodo_pago = 'transferencia';

  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp;
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      expediente_id, organization_id, tipo_documento, storage_path,
      nombre_original, mime_type, size_bytes, uploaded_by, uploaded_by_role,
      estatus_revision, version
    ) VALUES (
      v_exp, v_org, v_tipo, 'arm143/' || v_exp::text || '/' || v_tipo,
      v_tipo || '.pdf', 'application/pdf', 1024, v_asesor, 'asesor',
      'subido', 1
    );
  END LOOP;

  SELECT count(*) INTO v_docs_before
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL;

  SELECT count(*) INTO v_citas_before
  FROM public.agenda_bookings b
  WHERE b.expediente_id = v_exp;

  -- 1) Asesor ajeno bloqueado
  PERFORM public.__rpc_arm_assert(
    public.__rpc_arm_expect_fail(v_asesor2, v_exp, 'asesor dueño'),
    '1: asesor ajeno'
  );

  -- 2) Editor bloqueado
  PERFORM public.__rpc_arm_assert(
    public.__rpc_arm_expect_fail(v_editor, v_exp, 'rol no autorizado'),
    '2: editor'
  );

  -- 3) Cancelado bloqueado
  PERFORM public.__rpc_arm_assert(
    public.__rpc_arm_expect_fail(v_asesor, v_exp_cancel, 'cancelado'),
    '3: cancelado'
  );

  -- 4) Nunca enviado AHORA permitido (hotfix 143)
  v_result := public.__rpc_arm_call(v_asesor, v_exp_new);
  PERFORM public.__rpc_arm_assert((v_result->>'ok')::boolean, '4: ok never-sent');
  PERFORM public.__rpc_arm_assert((v_result->>'changed')::boolean, '4: changed');
  PERFORM public.__rpc_arm_assert((v_result->>'era_primer_envio')::boolean, '4: primer envío');
  PERFORM public.__rpc_arm_assert((v_result->>'expediente_id')::uuid = v_exp_new, '4: mismo id');
  PERFORM public.__rpc_arm_assert((v_result->>'reingreso_manual_count')::int = 1, '4: count=1');
  SELECT e.id, e.etapa_actual, e.subestado INTO v_id, v_etapa, v_sub
  FROM public.expedientes e WHERE e.id = v_exp_new;
  PERFORM public.__rpc_arm_assert(v_id = v_exp_new, '4: id intacto');
  PERFORM public.__rpc_arm_assert(v_etapa = 1, '4: etapa=1');
  PERFORM public.__rpc_arm_assert(v_sub = 'en_validacion_mesa', '4: subestado');
  PERFORM public.__rpc_arm_assert(
    (SELECT e.submitted_to_mesa FROM public.expedientes e WHERE e.id = v_exp_new),
    '4: submitted'
  );

  SELECT count(*) INTO v_nss_count FROM public.expedientes e WHERE e.nss = '91430000022';
  PERFORM public.__rpc_arm_assert(v_nss_count = 1, '4: sin duplicar NSS');

  -- 5) Sin docs / sin monto / sin datos (etapa 8) permitido
  v_result := public.__rpc_arm_call(v_asesor, v_exp_empty);
  PERFORM public.__rpc_arm_assert((v_result->>'ok')::boolean, '5: ok empty');
  PERFORM public.__rpc_arm_assert((v_result->>'reingreso_manual_count')::int = 1, '5: count=1');
  SELECT e.etapa_actual INTO v_etapa FROM public.expedientes e WHERE e.id = v_exp_empty;
  PERFORM public.__rpc_arm_assert(v_etapa = 1, '5: etapa=1');

  -- 6) Reingreso OK en expediente con docs: mismo id, count 1, docs/citas intactos
  v_result := public.__rpc_arm_call(v_asesor, v_exp);
  PERFORM public.__rpc_arm_assert((v_result->>'ok')::boolean, '6: ok');
  PERFORM public.__rpc_arm_assert((v_result->>'changed')::boolean, '6: changed');
  PERFORM public.__rpc_arm_assert((v_result->>'expediente_id')::uuid = v_exp, '6: mismo id');
  PERFORM public.__rpc_arm_assert((v_result->>'precalificacion_id')::uuid = v_exp, '6: precal=id');
  PERFORM public.__rpc_arm_assert((v_result->>'reingreso_manual_count')::int = 1, '6: count=1');
  PERFORM public.__rpc_arm_assert((v_result->>'era_primer_envio')::boolean = false, '6: no primer');

  SELECT e.id, e.etapa_actual, e.subestado, e.reingreso_manual_count
  INTO v_id, v_etapa, v_sub, v_count
  FROM public.expedientes e WHERE e.id = v_exp;
  PERFORM public.__rpc_arm_assert(v_id = v_exp, '6: id intacto');
  PERFORM public.__rpc_arm_assert(v_etapa = 1, '6: etapa=1');
  PERFORM public.__rpc_arm_assert(v_sub = 'en_validacion_mesa', '6: subestado');
  PERFORM public.__rpc_arm_assert(v_count = 1, '6: count persistido');

  SELECT count(*) INTO v_docs_after
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp AND d.deleted_at IS NULL;
  PERFORM public.__rpc_arm_assert(v_docs_after = v_docs_before, '6: docs intactos');

  SELECT count(*) INTO v_citas_after
  FROM public.agenda_bookings b
  WHERE b.expediente_id = v_exp;
  PERFORM public.__rpc_arm_assert(v_citas_after = v_citas_before, '6: citas intactas');

  SELECT count(*) INTO v_nss_count FROM public.expedientes e WHERE e.nss = '91430000021';
  PERFORM public.__rpc_arm_assert(v_nss_count = 1, '6: sin duplicar NSS');

  SELECT count(*) INTO v_log
  FROM public.action_log al
  WHERE al.action = 'expediente_reingreso_mesa' AND al.entity_id = v_exp;
  PERFORM public.__rpc_arm_assert(v_log >= 1, '6: action_log');

  -- 7) Segundo reingreso → count 2 (tras salir de ventana idempotente)
  UPDATE public.expedientes
  SET reingreso_manual_at = NOW() - INTERVAL '1 minute', etapa_actual = 11, subestado = 'en_proceso'
  WHERE id = v_exp;
  v_result := public.__rpc_arm_call(v_asesor, v_exp);
  PERFORM public.__rpc_arm_assert((v_result->>'reingreso_manual_count')::int = 2, '7: count=2');
  SELECT e.reingreso_manual_count, e.etapa_actual INTO v_count, v_etapa
  FROM public.expedientes e WHERE e.id = v_exp;
  PERFORM public.__rpc_arm_assert(v_count = 2, '7: count persistido 2');
  PERFORM public.__rpc_arm_assert(v_etapa = 1, '7: etapa reset 1');

  -- 8) Idempotencia doble clic (ventana 5s)
  v_result := public.__rpc_arm_call(v_asesor, v_exp);
  PERFORM public.__rpc_arm_assert((v_result->>'idempotent')::boolean = true, '8: idempotent');
  PERFORM public.__rpc_arm_assert((v_result->>'changed')::boolean = false, '8: not changed');
  SELECT e.reingreso_manual_count INTO v_count FROM public.expedientes e WHERE e.id = v_exp;
  PERFORM public.__rpc_arm_assert(v_count = 2, '8: count no duplica');

  -- 9) P072 column untouched
  PERFORM public.__rpc_arm_assert(
    (SELECT e.reingreso_rechazo_id IS NULL FROM public.expedientes e WHERE e.id = v_exp),
    '9: reingreso_rechazo_id intacto'
  );

  -- 10) Cero expedientes nuevos por NSS de los casos
  SELECT count(*) INTO v_count FROM public.expedientes e
  WHERE e.organization_id = v_org
    AND e.nss IN ('91430000021', '91430000022', '91430000023', '91430000024');
  PERFORM public.__rpc_arm_assert(v_count = 4, '10: cero duplicados de expediente');

  RAISE NOTICE 'RPC asesor_enviar_reingreso_a_mesa (143): tests OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_arm_expect_fail(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_arm_call(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_arm_reset();
DROP FUNCTION IF EXISTS public.__rpc_arm_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_arm_assert(BOOLEAN, TEXT);
