-- ConCasa CRM — P119: mesa_set_expediente_marcador
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p119_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P119 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p119_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::TEXT, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p119_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID;
  v_mesa UUID := gen_random_uuid();
  v_interno UUID := gen_random_uuid();
  v_asesor UUID := gen_random_uuid();
  v_exp UUID := gen_random_uuid();
  v_result JSONB;
  v_active BOOLEAN;
  v_etapa SMALLINT;
  v_cnt INT;
BEGIN
  PERFORM public.__p119_reset();

  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  PERFORM public.__p119_assert(v_org IS NOT NULL, 'org');

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES (
    v_mesa, v_org, 'p119.mesa@test.local', 'P119 Mesa', 'mesa_admin', true
  );
  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, active
  ) VALUES (
    v_interno, v_org, 'p119.interno@test.local', 'P119 Interno', 'mesa_interno', 'interno', true
  );
  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, active
  ) VALUES (
    v_asesor, v_org, 'p119.asesor@test.local', 'P119 Asesor', 'asesor', true
  );

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, etapa_actual, subestado, ciclo_estado, submitted_to_mesa,
    origen_mesa
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '11911911911', 'Cliente P119',
    '5511111191', 2, 'en_proceso', 'activo', true, 'interno'
  );

  -- 1) mesa_admin activa
  PERFORM public.__p119_auth(v_mesa);
  SELECT public.mesa_set_expediente_marcador(v_exp, 'tiene_datos', true) INTO v_result;
  PERFORM public.__p119_assert(COALESCE((v_result->>'ok')::boolean, false), '1 ok');
  PERFORM public.__p119_assert(COALESCE((v_result->>'active')::boolean, false), '1 active');

  PERFORM public.__p119_reset();
  SELECT active INTO v_active
  FROM public.expediente_mesa_marcadores
  WHERE expediente_id = v_exp AND tipo = 'tiene_datos';
  PERFORM public.__p119_assert(v_active IS TRUE, '1 persisted');

  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p119_assert(v_etapa = 2, '1 no cambia etapa');

  -- 2) idempotente
  PERFORM public.__p119_auth(v_mesa);
  SELECT public.mesa_set_expediente_marcador(v_exp, 'tiene_datos', true) INTO v_result;
  PERFORM public.__p119_assert(COALESCE((v_result->>'idempotent')::boolean, false), '2 idempotent');

  -- 3) desactivar
  SELECT public.mesa_set_expediente_marcador(v_exp, 'tiene_datos', false) INTO v_result;
  PERFORM public.__p119_assert(NOT COALESCE((v_result->>'active')::boolean, true), '3 inactive');

  -- 4) tipo inválido
  BEGIN
    PERFORM public.mesa_set_expediente_marcador(v_exp, 'foo', true);
    RAISE EXCEPTION 'P119 TEST FAIL: debió rechazar tipo';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'P119 TEST FAIL:%' THEN RAISE; END IF;
      PERFORM public.__p119_assert(SQLERRM ILIKE '%tipo no permitido%', '4 tipo');
  END;

  -- 5) asesor bloqueado
  PERFORM public.__p119_auth(v_asesor);
  BEGIN
    PERFORM public.mesa_set_expediente_marcador(v_exp, 'tiene_datos', true);
    RAISE EXCEPTION 'P119 TEST FAIL: asesor no debía poder';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'P119 TEST FAIL:%' THEN RAISE; END IF;
      PERFORM public.__p119_assert(
        SQLERRM ILIKE '%no autorizado%' OR SQLERRM ILIKE '%42501%',
        '5 asesor'
      );
  END;

  -- 6) mesa_interno puede
  PERFORM public.__p119_auth(v_interno);
  SELECT public.mesa_set_expediente_marcador(v_exp, 'tiene_datos', true) INTO v_result;
  PERFORM public.__p119_assert(COALESCE((v_result->>'active')::boolean, false), '6 interno');

  -- 7) unique org+exp+tipo
  PERFORM public.__p119_reset();
  SELECT count(*)::int INTO v_cnt
  FROM public.expediente_mesa_marcadores
  WHERE expediente_id = v_exp AND tipo = 'tiene_datos';
  PERFORM public.__p119_assert(v_cnt = 1, '7 unique row');

  RAISE NOTICE 'P119 mesa_set_expediente_marcador: OK';
END;
$$;

DROP FUNCTION public.__p119_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p119_auth(UUID);
DROP FUNCTION public.__p119_reset();

ROLLBACK;
