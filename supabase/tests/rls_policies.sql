-- ConCasa CRM — pruebas RLS locales (ejecutar tras db reset)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rls_policies.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rls_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RLS TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rls_test_count_expedientes_as(p_user_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  SELECT count(*) INTO v_count FROM public.expedientes;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rls_test_count_action_log_as(p_user_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  SELECT count(*) INTO v_count FROM public.action_log;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rls_test_role_as(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  SELECT public.current_app_role()::text INTO v_role;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rls_test_sees_expediente_as(p_user_id UUID, p_exp_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  SELECT EXISTS (
    SELECT 1 FROM public.expedientes e WHERE e.id = p_exp_id
  ) INTO v_found;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_found;
END;
$$;

-- UUIDs dev (ver seed.sql)
-- asesor_interno   00000000-0000-4000-8001-000000000001
-- asesor_externo   00000000-0000-4000-8001-000000000002
-- editor           00000000-0000-4000-8002-000000000001
-- mesa_admin       00000000-0000-4000-8003-000000000001
-- mesa_interno     00000000-0000-4000-8004-000000000001
-- mesa_externo     00000000-0000-4000-8005-000000000001
-- super_admin      00000000-0000-4000-8006-000000000001

DO $$
BEGIN
  PERFORM public.__rls_test_assert(
    public.__rls_test_role_as('00000000-0000-4000-8001-000000000001') = 'asesor',
    'helper current_app_role asesor'
  );

  PERFORM public.__rls_test_assert(
    public.__rls_test_count_expedientes_as('00000000-0000-4000-8001-000000000001') = 2,
    'asesor ve solo sus expedientes (2)'
  );

  PERFORM public.__rls_test_assert(
  NOT public.__rls_test_sees_expediente_as(
      '00000000-0000-4000-8001-000000000001',
      '00000000-0000-4000-9001-000000000004'
    ),
    'asesor NO ve expediente de otro asesor'
  );

  PERFORM public.__rls_test_assert(
    public.__rls_test_count_expedientes_as('00000000-0000-4000-8002-000000000001') = 4,
    'editor ve expedientes de la organización'
  );

  PERFORM public.__rls_test_assert(
    public.__rls_test_count_expedientes_as('00000000-0000-4000-8004-000000000001') = 2,
    'mesa_interno ve solo enviados origen interno'
  );

  PERFORM public.__rls_test_assert(
    public.__rls_test_count_expedientes_as('00000000-0000-4000-8005-000000000001') = 1,
    'mesa_externo ve solo enviados origen externo'
  );

  PERFORM public.__rls_test_assert(
    public.__rls_test_count_expedientes_as('00000000-0000-4000-8003-000000000001') = 3,
    'mesa_admin ve enviados a Mesa'
  );

  PERFORM public.__rls_test_assert(
    public.__rls_test_count_expedientes_as('00000000-0000-4000-8006-000000000001') = 4,
    'super_admin ve todos'
  );

  PERFORM public.__rls_test_assert(
    public.__rls_test_count_action_log_as('00000000-0000-4000-8001-000000000001') = 0,
    'asesor no ve action_log'
  );

  PERFORM public.__rls_test_assert(
    public.__rls_test_count_action_log_as('00000000-0000-4000-8003-000000000001') >= 1,
    'mesa_admin ve action_log'
  );

  RAISE NOTICE 'RLS tests: ALL PASSED';
END;
$$;

DROP FUNCTION IF EXISTS public.__rls_test_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__rls_test_count_expedientes_as(UUID);
DROP FUNCTION IF EXISTS public.__rls_test_count_action_log_as(UUID);
DROP FUNCTION IF EXISTS public.__rls_test_role_as(UUID);
DROP FUNCTION IF EXISTS public.__rls_test_sees_expediente_as(UUID, UUID);
