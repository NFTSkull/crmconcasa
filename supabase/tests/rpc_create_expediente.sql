-- ConCasa CRM — pruebas P3C RPC create_expediente
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_create_expediente.sql

\set ON_ERROR_STOP on

-- UUIDs dev (seed.sql)
-- org            00000000-0000-4000-8000-000000000001
-- asesor_interno 00000000-0000-4000-8001-000000000001
-- asesor_externo 00000000-0000-4000-8001-000000000002
-- editor         00000000-0000-4000-8002-000000000001
-- mesa_admin     00000000-0000-4000-8003-000000000001
-- mesa_interno   00000000-0000-4000-8004-000000000001
-- mesa_externo   00000000-0000-4000-8005-000000000001
-- super_admin    00000000-0000-4000-8006-000000000001

CREATE OR REPLACE FUNCTION public.__rpc_ce_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC CE TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ce_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ce_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ce_test_call_as(
  p_user_id UUID,
  p_programa public.programa DEFAULT 'mejoravit',
  p_nss TEXT DEFAULT '88000000001',
  p_nombre TEXT DEFAULT 'Cliente RPC CE Test',
  p_telefono TEXT DEFAULT '5588000001',
  p_direccion TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_ce_test_set_auth(p_user_id);
  SELECT public.create_expediente(
    p_programa, p_nss, p_nombre, p_telefono, p_direccion
  ) INTO v_result;
  PERFORM public.__rpc_ce_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ce_test_expect_fail(
  p_user_id UUID,
  p_programa public.programa DEFAULT 'mejoravit',
  p_nss TEXT DEFAULT '88000000001',
  p_nombre TEXT DEFAULT 'Cliente RPC CE Test',
  p_telefono TEXT DEFAULT '5588000001',
  p_direccion TEXT DEFAULT ''
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_ce_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.create_expediente(
      p_programa, p_nss, p_nombre, p_telefono, p_direccion
    );
    PERFORM public.__rpc_ce_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_ce_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ce_test_cleanup(p_nss TEXT, p_programa public.programa)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.editor_decisions ed
  USING public.expedientes e
  WHERE ed.expediente_id = e.id
    AND e.nss = p_nss
    AND e.programa = p_programa;

  DELETE FROM public.action_log al
  USING public.expedientes e
  WHERE al.entity_type = 'expediente'
    AND al.entity_id = e.id
    AND e.nss = p_nss
    AND e.programa = p_programa;

  DELETE FROM public.expedientes e
  WHERE e.nss = p_nss
    AND e.programa = p_programa;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_int UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_ext UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';
  v_nss_ok TEXT := '88000000010';
  v_nss_dup TEXT := '88000000011';
  v_nss_origen_ext TEXT := '88000000012';
  v_result JSONB;
  v_exp_id UUID;
  v_decision public.editor_decision;
  v_origen public.origen_mesa;
  v_log_count INTEGER;
BEGIN
  PERFORM public.__rpc_ce_test_cleanup(v_nss_ok, 'mejoravit');
  PERFORM public.__rpc_ce_test_cleanup(v_nss_dup, 'mejoravit');
  PERFORM public.__rpc_ce_test_cleanup(v_nss_origen_ext, 'subcuenta');

  -- 1) asesor activo crea expediente OK
  v_result := public.__rpc_ce_test_call_as(
    v_asesor_int, 'mejoravit', v_nss_ok, 'Cliente CE OK', '5588000010', 'Calle 1'
  );
  v_exp_id := (v_result->>'id')::UUID;
  PERFORM public.__rpc_ce_test_assert(
    v_exp_id IS NOT NULL,
    'asesor activo debe recibir id de expediente'
  );
  PERFORM public.__rpc_ce_test_assert(
    (v_result->>'etapa_actual')::INTEGER = 1,
    'etapa_actual inicial debe ser 1'
  );
  PERFORM public.__rpc_ce_test_assert(
    v_result->>'subestado' = 'pendiente',
    'subestado inicial debe ser pendiente'
  );
  PERFORM public.__rpc_ce_test_assert(
    v_result->>'ciclo_estado' = 'activo',
    'ciclo_estado inicial debe ser activo'
  );
  PERFORM public.__rpc_ce_test_assert(
    (v_result->>'submitted_to_mesa')::BOOLEAN = false,
    'submitted_to_mesa inicial debe ser false'
  );

  -- 2) crea editor_decisions pendiente
  SELECT ed.decision INTO v_decision
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = v_exp_id;
  PERFORM public.__rpc_ce_test_assert(
    v_decision = 'pendiente',
    'debe crear editor_decisions con decision pendiente'
  );

  -- 3) origen_mesa respeta tipo_asesor_origen (interno)
  SELECT e.origen_mesa INTO v_origen
  FROM public.expedientes e
  WHERE e.id = v_exp_id;
  PERFORM public.__rpc_ce_test_assert(
    v_origen = 'interno',
    'asesor interno debe persistir origen_mesa interno'
  );

  -- 3b) origen_mesa externo
  v_result := public.__rpc_ce_test_call_as(
    v_asesor_ext, 'subcuenta', v_nss_origen_ext, 'Cliente CE Externo', '5588000012'
  );
  v_exp_id := (v_result->>'id')::UUID;
  SELECT e.origen_mesa INTO v_origen
  FROM public.expedientes e
  WHERE e.id = v_exp_id;
  PERFORM public.__rpc_ce_test_assert(
    v_origen = 'externo',
    'asesor externo debe persistir origen_mesa externo'
  );

  -- 4) NSS inválido falla
  PERFORM public.__rpc_ce_test_assert(
    public.__rpc_ce_test_expect_fail(v_asesor_int, 'mejoravit', '123', 'X', '5588000099'),
    'NSS inválido debe fallar'
  );

  -- 5) teléfono inválido falla
  PERFORM public.__rpc_ce_test_assert(
    public.__rpc_ce_test_expect_fail(v_asesor_int, 'mejoravit', '88000000099', 'X', '123'),
    'teléfono inválido debe fallar'
  );

  -- 6) nombre vacío falla
  PERFORM public.__rpc_ce_test_assert(
    public.__rpc_ce_test_expect_fail(v_asesor_int, 'mejoravit', '88000000098', '   ', '5588000098'),
    'nombre vacío debe fallar'
  );

  -- 7) duplicado activo NSS+programa falla
  PERFORM public.__rpc_ce_test_cleanup(v_nss_dup, 'mejoravit');
  PERFORM public.__rpc_ce_test_call_as(
    v_asesor_int, 'mejoravit', v_nss_dup, 'Cliente Dup 1', '5588000011'
  );
  PERFORM public.__rpc_ce_test_assert(
    public.__rpc_ce_test_expect_fail(v_asesor_int, 'mejoravit', v_nss_dup, 'Cliente Dup 2', '5588000011'),
    'duplicado activo NSS+programa debe fallar'
  );

  -- 8) roles no asesor rechazados
  PERFORM public.__rpc_ce_test_assert(
    public.__rpc_ce_test_expect_fail(v_editor, 'mejoravit', '88000000020', 'X', '5588000020'),
    'editor no debe crear expediente'
  );
  PERFORM public.__rpc_ce_test_assert(
    public.__rpc_ce_test_expect_fail(v_mesa_admin, 'mejoravit', '88000000021', 'X', '5588000021'),
    'mesa_admin no debe crear expediente'
  );
  PERFORM public.__rpc_ce_test_assert(
    public.__rpc_ce_test_expect_fail(v_mesa_int, 'mejoravit', '88000000022', 'X', '5588000022'),
    'mesa_interno no debe crear expediente'
  );
  PERFORM public.__rpc_ce_test_assert(
    public.__rpc_ce_test_expect_fail(v_mesa_ext, 'mejoravit', '88000000023', 'X', '5588000023'),
    'mesa_externo no debe crear expediente'
  );
  PERFORM public.__rpc_ce_test_assert(
    public.__rpc_ce_test_expect_fail(v_super, 'mejoravit', '88000000024', 'X', '5588000024'),
    'super_admin no debe crear expediente desde RPC P3C'
  );

  -- 9) action_log expediente.create
  SELECT COUNT(*)::INTEGER INTO v_log_count
  FROM public.action_log al
  WHERE al.entity_id = (v_result->>'id')::UUID
    AND al.action = 'expediente.create'
    AND al.organization_id = v_org;
  PERFORM public.__rpc_ce_test_assert(
    v_log_count >= 1,
    'debe registrar action_log expediente.create'
  );

  -- cleanup fixtures de prueba
  PERFORM public.__rpc_ce_test_cleanup(v_nss_ok, 'mejoravit');
  PERFORM public.__rpc_ce_test_cleanup(v_nss_dup, 'mejoravit');
  PERFORM public.__rpc_ce_test_cleanup(v_nss_origen_ext, 'subcuenta');

  RAISE NOTICE 'RPC create_expediente tests: ALL PASSED';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_ce_test_cleanup(TEXT, public.programa);
DROP FUNCTION IF EXISTS public.__rpc_ce_test_expect_fail(UUID, public.programa, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_ce_test_call_as(UUID, public.programa, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_ce_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_ce_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_ce_test_assert(BOOLEAN, TEXT);
