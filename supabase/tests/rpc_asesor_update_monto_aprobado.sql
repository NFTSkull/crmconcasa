-- ConCasa CRM — pruebas P045 RPC asesor_update_monto_aprobado
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_asesor_update_monto_aprobado.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_auma_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC AUMA TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_auma_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_auma_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_auma_test_call_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_monto NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_auma_test_set_auth(p_user_id);
  SELECT public.asesor_update_monto_aprobado(p_expediente_id, p_monto) INTO v_result;
  PERFORM public.__rpc_auma_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_auma_test_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_monto NUMERIC,
  p_msg_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_err TEXT;
BEGIN
  PERFORM public.__rpc_auma_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.asesor_update_monto_aprobado(p_expediente_id, p_monto);
    PERFORM public.__rpc_auma_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      PERFORM public.__rpc_auma_test_reset_auth();
      IF p_msg_contains IS NOT NULL AND position(p_msg_contains IN v_err) = 0 THEN
        RAISE EXCEPTION 'RPC AUMA TEST FAIL: esperaba mensaje con "%", obtuvo: %', p_msg_contains, v_err;
      END IF;
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_auma_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_submitted BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture AUMA', '5599999999', 'interno', p_submitted, 1, 'pendiente'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = CASE WHEN EXCLUDED.submitted_to_mesa THEN NOW() ELSE NULL END,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_auma_test_insert_editor(
  p_expediente_id UUID,
  p_org_id UUID,
  p_decision public.editor_decision DEFAULT 'no_cumple',
  p_monto NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, notas_revision
  ) VALUES (
    p_expediente_id, p_org_id, p_decision, p_monto, 'nota fixture'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    notas_revision = EXCLUDED.notas_revision,
    updated_at = NOW();
END;
$$;

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';

  v_exp_ok UUID := '00000000-0000-4000-9010-000000000010';
  v_exp_no_ed UUID := '00000000-0000-4000-9010-000000000020';
  v_exp_other UUID := '00000000-0000-4000-9010-000000000030';
  v_exp_mesa UUID := '00000000-0000-4000-9010-000000000040';

  v_result JSONB;
  v_decision public.editor_decision;
  v_monto NUMERIC;
  v_notas TEXT;
  v_log_count BIGINT;
BEGIN
  PERFORM public.__rpc_auma_test_insert_expediente(v_exp_ok, v_org_id, v_asesor_a1, '90101000010');
  PERFORM public.__rpc_auma_test_insert_editor(v_exp_ok, v_org_id, 'no_cumple', NULL);

  PERFORM public.__rpc_auma_test_insert_expediente(v_exp_no_ed, v_org_id, v_asesor_a1, '90102000020');
  DELETE FROM public.editor_decisions WHERE expediente_id = v_exp_no_ed;

  PERFORM public.__rpc_auma_test_insert_expediente(v_exp_other, v_org_id, v_asesor_a2, '90103000030');
  PERFORM public.__rpc_auma_test_insert_editor(v_exp_other, v_org_id, 'no_cumple', NULL);

  PERFORM public.__rpc_auma_test_insert_expediente(v_exp_mesa, v_org_id, v_asesor_a1, '90104000040', true);
  PERFORM public.__rpc_auma_test_insert_editor(v_exp_mesa, v_org_id, 'no_cumple', NULL);

  -- Test 1: asesor dueño actualiza monto sin cambiar decision ni notas
  v_result := public.__rpc_auma_test_call_as(v_asesor_a1, v_exp_ok, 250000);
  PERFORM public.__rpc_auma_test_assert((v_result->>'ok')::boolean = true, 'test 1: ok=true');
  PERFORM public.__rpc_auma_test_assert(
    (v_result->>'monto_aprobado')::numeric = 250000,
    'test 1: monto en respuesta'
  );
  SELECT ed.decision, ed.monto_aprobado, ed.notas_revision
  INTO v_decision, v_monto, v_notas
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = v_exp_ok;
  PERFORM public.__rpc_auma_test_assert(v_decision = 'no_cumple', 'test 1: decision intacta');
  PERFORM public.__rpc_auma_test_assert(v_monto = 250000, 'test 1: monto persistido');
  PERFORM public.__rpc_auma_test_assert(v_notas = 'nota fixture', 'test 1: notas intactas');

  SELECT count(*)::bigint INTO v_log_count
  FROM public.action_log al
  WHERE al.action = 'asesor.monto_aprobado.update'
    AND al.entity_id = v_exp_ok;
  PERFORM public.__rpc_auma_test_assert(v_log_count >= 1, 'test 1: action_log');

  -- Test 2: inserta editor_decisions pendiente si no existía
  v_result := public.__rpc_auma_test_call_as(v_asesor_a1, v_exp_no_ed, 180000);
  PERFORM public.__rpc_auma_test_assert((v_result->>'ok')::boolean = true, 'test 2: ok=true');
  SELECT ed.decision, ed.monto_aprobado
  INTO v_decision, v_monto
  FROM public.editor_decisions ed
  WHERE ed.expediente_id = v_exp_no_ed;
  PERFORM public.__rpc_auma_test_assert(v_decision = 'pendiente', 'test 2: decision pendiente');
  PERFORM public.__rpc_auma_test_assert(v_monto = 180000, 'test 2: monto insertado');

  -- Test 3: asesor no dueño bloqueado
  PERFORM public.__rpc_auma_test_assert(
    public.__rpc_auma_test_expect_fail(v_asesor_a1, v_exp_other, 100000, 'solo el asesor dueño'),
    'test 3: asesor ajeno bloqueado'
  );

  -- Test 4: editor bloqueado
  PERFORM public.__rpc_auma_test_assert(
    public.__rpc_auma_test_expect_fail(v_editor, v_exp_ok, 100000, 'rol no autorizado'),
    'test 4: editor bloqueado'
  );

  -- Test 5: monto inválido
  PERFORM public.__rpc_auma_test_assert(
    public.__rpc_auma_test_expect_fail(v_asesor_a1, v_exp_ok, 0, 'debe ser mayor a 0'),
    'test 5: monto cero bloqueado'
  );

  -- Test 6: ya enviado a Mesa
  PERFORM public.__rpc_auma_test_assert(
    public.__rpc_auma_test_expect_fail(v_asesor_a1, v_exp_mesa, 100000, 'ya enviado a Mesa'),
    'test 6: enviado a Mesa bloqueado'
  );

  RAISE NOTICE 'RPC asesor_update_monto_aprobado: todos los tests pasaron';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_auma_test_insert_editor(UUID, UUID, public.editor_decision, NUMERIC);
DROP FUNCTION IF EXISTS public.__rpc_auma_test_insert_expediente(UUID, UUID, UUID, CHAR(11), BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_auma_test_expect_fail(UUID, UUID, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_auma_test_call_as(UUID, UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.__rpc_auma_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_auma_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_auma_test_assert(BOOLEAN, TEXT);
