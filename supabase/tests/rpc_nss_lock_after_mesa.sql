-- ConCasa CRM — P049 NSS bloqueado solo tras cliente_datos + envío a Mesa
-- Uso: psql -f supabase/tests/rpc_nss_lock_after_mesa.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_nss_lock_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC NSS LOCK TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_nss_lock_test_set_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_nss_lock_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_nss_lock_test_cleanup(p_nss TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_nss TEXT := public.normalize_nss_mexico(p_nss);
BEGIN
  DELETE FROM public.cliente_datos cd
  USING public.expedientes e
  WHERE cd.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.editor_decisions ed
  USING public.expedientes e
  WHERE ed.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expediente_documentos d
  USING public.expedientes e
  WHERE d.expediente_id = e.id AND e.nss = v_nss;
  DELETE FROM public.expedientes e WHERE e.nss = v_nss;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_nss_lock_test_create(
  p_user UUID, p_nss TEXT, p_tel TEXT DEFAULT '5512345678'
)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_nss_lock_test_set_auth(p_user);
  SELECT public.create_expediente('mejoravit', p_nss, 'Cliente NSS Lock', p_tel, '') INTO v_result;
  PERFORM public.__rpc_nss_lock_test_reset_auth();
  RETURN (v_result->>'id')::UUID;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_nss_lock_test_expect_create_fail(
  p_user UUID, p_nss TEXT, p_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__rpc_nss_lock_test_set_auth(p_user);
  BEGIN
    PERFORM public.create_expediente('mejoravit', p_nss, 'Fail NSS', '5511111111', '');
    PERFORM public.__rpc_nss_lock_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_nss_lock_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC NSS LOCK TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_nss_lock_test_seed_ready_enviar(
  p_exp UUID, p_org UUID, p_asesor UUID
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_tipo TEXT;
BEGIN
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (p_exp, p_org, 'aprobado', 15000)
  ON CONFLICT (expediente_id) DO UPDATE SET monto_aprobado = 15000;
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    p_exp, p_org, '{"nombreCliente":"B"}'::jsonb, 'completo', 10, 4500, 'transferencia'
  )
  ON CONFLICT (expediente_id) DO NOTHING;
  DELETE FROM public.expediente_documentos WHERE expediente_id = p_exp;
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org, p_exp, v_tipo,
      'dev/nss/' || p_exp::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor, 'asesor'
    );
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_nss_lock_test_seed_mesa(
  p_exp UUID, p_org UUID, p_asesor UUID
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (p_exp, p_org, 'aprobado', 15000)
  ON CONFLICT (expediente_id) DO UPDATE SET monto_aprobado = 15000;
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    p_exp, p_org, '{"nombreCliente":"A"}'::jsonb, 'completo', 10, 4500, 'transferencia'
  )
  ON CONFLICT (expediente_id) DO NOTHING;
  UPDATE public.expedientes
  SET submitted_to_mesa = true, fecha_envio_mesa = NOW(), subestado = 'en_validacion_mesa'
  WHERE id = p_exp;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_nss_lock_test_enviar_expect_fail(p_user UUID, p_exp UUID, p_contains TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__rpc_nss_lock_test_set_auth(p_user);
  BEGIN
    PERFORM public.enviar_a_mesa(p_exp);
    PERFORM public.__rpc_nss_lock_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_nss_lock_test_reset_auth();
    IF position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC NSS LOCK TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_nss TEXT := '88123456789';
  v_exp_a UUID;
  v_exp_b UUID;
BEGIN
  PERFORM public.__rpc_nss_lock_test_cleanup(v_nss);

  -- A) Expediente A sin envío a Mesa: crear B con mismo NSS OK
  v_exp_a := public.__rpc_nss_lock_test_create(v_asesor, v_nss, '5511111111');
  v_exp_b := public.__rpc_nss_lock_test_create(v_asesor, v_nss, '5522222222');
  PERFORM public.__rpc_nss_lock_test_assert(v_exp_a IS NOT NULL AND v_exp_b IS NOT NULL, 'test A: segundo expediente permitido');

  -- E) NSS con guiones/espacios equivale al mismo NSS
  PERFORM public.__rpc_nss_lock_test_cleanup('88999888777');
  v_exp_a := public.__rpc_nss_lock_test_create(v_asesor, '88-99 9888777', '5533333333');
  v_exp_b := public.__rpc_nss_lock_test_create(v_asesor, '88999888777', '5544444444');
  PERFORM public.__rpc_nss_lock_test_assert(v_exp_a <> v_exp_b, 'test E: 88-99 9888777 = 88999888777');

  PERFORM public.__rpc_nss_lock_test_cleanup(v_nss);

  -- B) A con cliente_datos + enviado a Mesa: crear B bloqueado
  v_exp_a := public.__rpc_nss_lock_test_create(v_asesor, v_nss, '5511111111');
  PERFORM public.__rpc_nss_lock_test_seed_mesa(v_exp_a, v_org, v_asesor);
  PERFORM public.__rpc_nss_lock_test_assert(
    public.__rpc_nss_lock_test_expect_create_fail(v_asesor, v_nss, 'enviado a Mesa'),
    'test B: crear bloqueado si NSS ya en Mesa'
  );

  PERFORM public.__rpc_nss_lock_test_cleanup(v_nss);

  -- C) A y B mismo NSS sin envío: ambos OK; A envía; B no puede enviar
  v_exp_a := public.__rpc_nss_lock_test_create(v_asesor, v_nss, '5511111111');
  v_exp_b := public.__rpc_nss_lock_test_create(v_asesor, v_nss, '5522222222');
  PERFORM public.__rpc_nss_lock_test_seed_mesa(v_exp_a, v_org, v_asesor);
  PERFORM public.__rpc_nss_lock_test_seed_ready_enviar(v_exp_b, v_org, v_asesor);
  PERFORM public.__rpc_nss_lock_test_assert(
    public.__rpc_nss_lock_test_enviar_expect_fail(v_asesor, v_exp_b, 'NSS_YA_BLOQUEADO'),
    'test C: B no puede enviar tras A en Mesa'
  );

  -- D) reenvío del mismo expediente ya enviado: error distinto (ya enviado), no NSS_YA_BLOQUEADO consigo mismo
  PERFORM public.__rpc_nss_lock_test_assert(
    public.__rpc_nss_lock_test_enviar_expect_fail(v_asesor, v_exp_a, 'ya fue enviado a Mesa'),
    'test D: reenvío A falla por ya enviado, no por NSS duplicado consigo'
  );

  PERFORM public.__rpc_nss_lock_test_cleanup(v_nss);
  RAISE NOTICE 'RPC nss_lock_after_mesa: 5 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_nss_lock_test_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_nss_lock_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_nss_lock_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_nss_lock_test_cleanup(TEXT);
DROP FUNCTION IF EXISTS public.__rpc_nss_lock_test_create(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_nss_lock_test_expect_create_fail(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_nss_lock_test_seed_ready_enviar(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_nss_lock_test_seed_mesa(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_nss_lock_test_enviar_expect_fail(UUID, UUID, TEXT);
