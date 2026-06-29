-- ConCasa CRM — pruebas RLS + GRANT SELECT mesa_expediente_ops
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/mesa_expediente_ops_rls.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__mesa_ops_rls_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'MESA OPS RLS TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_ops_rls_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_ops_rls_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_ops_rls_test_count_ops_as(p_user_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  PERFORM public.__mesa_ops_rls_test_set_auth(p_user_id);
  SELECT count(*) INTO v_count FROM public.mesa_expediente_ops;
  PERFORM public.__mesa_ops_rls_test_reset_auth();
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_ops_rls_test_sees_ops_as(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  PERFORM public.__mesa_ops_rls_test_set_auth(p_user_id);
  SELECT EXISTS (
    SELECT 1 FROM public.mesa_expediente_ops mo
    WHERE mo.expediente_id = p_expediente_id
  ) INTO v_found;
  PERFORM public.__mesa_ops_rls_test_reset_auth();
  RETURN v_found;
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_ops_rls_test_dml_denied(
  p_user_id UUID,
  p_dml TEXT,
  p_expediente_id UUID,
  p_org_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__mesa_ops_rls_test_set_auth(p_user_id);
  BEGIN
    IF p_dml = 'insert' THEN
      INSERT INTO public.mesa_expediente_ops (
        expediente_id, organization_id, estado_mesa
      ) VALUES (
        p_expediente_id, p_org_id, 'sin_asignar'
      );
    ELSIF p_dml = 'update' THEN
      UPDATE public.mesa_expediente_ops
      SET estado_mesa = 'trabajando'
      WHERE expediente_id = p_expediente_id;
    ELSIF p_dml = 'delete' THEN
      DELETE FROM public.mesa_expediente_ops
      WHERE expediente_id = p_expediente_id;
    END IF;
    PERFORM public.__mesa_ops_rls_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM public.__mesa_ops_rls_test_reset_auth();
      RETURN true;
    WHEN OTHERS THEN
      PERFORM public.__mesa_ops_rls_test_reset_auth();
      RETURN true;
  END;
END;
$$;

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_exp_int UUID := '00000000-0000-4000-9001-000000000001';
  v_exp_ext UUID := '00000000-0000-4000-9001-000000000002';
  v_count BIGINT;
BEGIN
  -- test 1: GRANT SELECT — mesa_interno puede leer filas visibles
  PERFORM public.__mesa_ops_rls_test_assert(
    public.__mesa_ops_rls_test_sees_ops_as(v_mesa_int, v_exp_int),
    'test 1: mesa_interno SELECT fila ops expediente interno visible'
  );

  -- test 2: RLS — mesa_interno no ve ops de expediente externo
  PERFORM public.__mesa_ops_rls_test_assert(
    NOT public.__mesa_ops_rls_test_sees_ops_as(v_mesa_int, v_exp_ext),
    'test 2: mesa_interno no ve ops expediente externo'
  );

  -- test 3: mesa_externo ve solo externo
  PERFORM public.__mesa_ops_rls_test_assert(
    public.__mesa_ops_rls_test_sees_ops_as(v_mesa_ext, v_exp_ext),
    'test 3a: mesa_externo SELECT fila ops expediente externo'
  );
  PERFORM public.__mesa_ops_rls_test_assert(
    NOT public.__mesa_ops_rls_test_sees_ops_as(v_mesa_ext, v_exp_int),
    'test 3b: mesa_externo no ve ops expediente interno'
  );

  -- test 4: conteo acotado por can_see_expediente
  v_count := public.__mesa_ops_rls_test_count_ops_as(v_mesa_int);
  PERFORM public.__mesa_ops_rls_test_assert(
    v_count >= 1 AND v_count < (SELECT count(*) FROM public.mesa_expediente_ops),
    'test 4: mesa_interno ve subconjunto de filas ops'
  );

  -- test 5–7: sin INSERT/UPDATE/DELETE directo para authenticated
  PERFORM public.__mesa_ops_rls_test_assert(
    public.__mesa_ops_rls_test_dml_denied(v_mesa_int, 'insert', v_exp_int, v_org_id),
    'test 5: authenticated no puede INSERT directo'
  );
  PERFORM public.__mesa_ops_rls_test_assert(
    public.__mesa_ops_rls_test_dml_denied(v_mesa_int, 'update', v_exp_int, v_org_id),
    'test 6: authenticated no puede UPDATE directo'
  );
  PERFORM public.__mesa_ops_rls_test_assert(
    public.__mesa_ops_rls_test_dml_denied(v_mesa_int, 'delete', v_exp_int, v_org_id),
    'test 7: authenticated no puede DELETE directo'
  );
END;
$$;

DROP FUNCTION IF EXISTS public.__mesa_ops_rls_test_dml_denied(UUID, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.__mesa_ops_rls_test_sees_ops_as(UUID, UUID);
DROP FUNCTION IF EXISTS public.__mesa_ops_rls_test_count_ops_as(UUID);
DROP FUNCTION IF EXISTS public.__mesa_ops_rls_test_reset_auth();
DROP FUNCTION IF EXISTS public.__mesa_ops_rls_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__mesa_ops_rls_test_assert(BOOLEAN, TEXT);
