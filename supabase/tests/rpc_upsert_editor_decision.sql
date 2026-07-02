-- ConCasa CRM — pruebas P2C-9 RPC upsert_editor_decision
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_upsert_editor_decision.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC ED TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_call_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_decision public.editor_decision,
  p_monto NUMERIC DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_ed_test_set_auth(p_user_id);
  SELECT public.upsert_editor_decision(
    p_expediente_id, p_decision, p_monto, p_motivo
  ) INTO v_result;
  PERFORM public.__rpc_ed_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_decision public.editor_decision,
  p_monto NUMERIC DEFAULT NULL,
  p_motivo TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_ed_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.upsert_editor_decision(
      p_expediente_id, p_decision, p_monto, p_motivo
    );
    PERFORM public.__rpc_ed_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_ed_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_call_enviar_as(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_ed_test_set_auth(p_user_id);
  SELECT public.enviar_a_mesa(p_expediente_id) INTO v_result;
  PERFORM public.__rpc_ed_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_expect_enviar_fail(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_ed_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.enviar_a_mesa(p_expediente_id);
    PERFORM public.__rpc_ed_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_ed_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_submitted BOOLEAN DEFAULT false,
  p_ciclo public.expediente_ciclo_estado DEFAULT 'activo',
  p_deleted_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado, deleted_at
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture Editor Decision', '5520202020', 'interno',
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    1, 'pendiente', p_ciclo, p_deleted_at
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    ciclo_estado = EXCLUDED.ciclo_estado,
    deleted_at = EXCLUDED.deleted_at,
    updated_at = NOW();

  DELETE FROM public.editor_decisions WHERE expediente_id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_insert_cliente(
  p_expediente_id UUID,
  p_org_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    p_expediente_id, p_org_id,
    jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Fixture'),
    'completo',
    10, 1500, 'transferencia'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos,
    estado = EXCLUDED.estado,
    porcentaje_cobro = EXCLUDED.porcentaje_cobro,
    monto_calculado = EXCLUDED.monto_calculado,
    metodo_pago = EXCLUDED.metodo_pago,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_ed_test_insert_docs(
  p_expediente_id UUID,
  p_org_id UUID,
  p_asesor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo TEXT;
BEGIN
  DELETE FROM public.expediente_documentos
  WHERE expediente_id = p_expediente_id
    AND tipo_documento = ANY(public.integration_doc_tipos_obligatorios());

  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_obligatorios()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org_id, p_expediente_id, v_tipo,
      'dev/ed/' || p_expediente_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor_id, 'asesor'
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_org_other UUID := '00000000-0000-4000-8000-000000000099';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';

  v_exp_create UUID := '00000000-0000-4000-9011-000000000010';
  v_exp_update UUID := '00000000-0000-4000-9011-000000000020';
  v_exp_no_cumple UUID := '00000000-0000-4000-9011-000000000030';
  v_exp_no_monto UUID := '00000000-0000-4000-9011-000000000040';
  v_exp_bad_monto UUID := '00000000-0000-4000-9011-000000000050';
  v_exp_asesor UUID := '00000000-0000-4000-9011-000000000060';
  v_exp_mesa UUID := '00000000-0000-4000-9011-000000000070';
  v_exp_super UUID := '00000000-0000-4000-9011-000000000080';
  v_exp_other_org UUID := '00000000-0000-4000-9011-000000000090';
  v_exp_deleted UUID := '00000000-0000-4000-9011-000000000100';
  v_exp_ciclo UUID := '00000000-0000-4000-9011-000000000110';
  v_exp_sent UUID := '00000000-0000-4000-9011-000000000120';
  v_exp_log UUID := '00000000-0000-4000-9011-000000000130';
  v_exp_side UUID := '00000000-0000-4000-9011-000000000140';
  v_exp_enviar_ok UUID := '00000000-0000-4000-9011-000000000150';
  v_exp_enviar_fail UUID := '00000000-0000-4000-9011-000000000160';

  v_result JSONB;
  v_etapa_before SMALLINT;
  v_submitted_before BOOLEAN;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org_other, 'org-fixture-99', 'Org Fixture 99', true)
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_create, v_org_id, v_asesor_a1, '91101000001');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_update, v_org_id, v_asesor_a1, '91102000002');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_no_cumple, v_org_id, v_asesor_a1, '91103000003');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_no_monto, v_org_id, v_asesor_a1, '91104000004');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_bad_monto, v_org_id, v_asesor_a1, '91105000005');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_asesor, v_org_id, v_asesor_a1, '91106000006');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_mesa, v_org_id, v_asesor_a1, '91107000007');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_super, v_org_id, v_asesor_a1, '91108000008');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_other_org, v_org_other, v_asesor_a1, '91109000009');
  PERFORM public.__rpc_ed_test_insert_expediente(
    v_exp_deleted, v_org_id, v_asesor_a1, '91110000010', false, 'activo', NOW()
  );
  PERFORM public.__rpc_ed_test_insert_expediente(
    v_exp_ciclo, v_org_id, v_asesor_a1, '91111000011', false, 'cerrado'
  );
  PERFORM public.__rpc_ed_test_insert_expediente(
    v_exp_sent, v_org_id, v_asesor_a1, '91112000012', true
  );
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_log, v_org_id, v_asesor_a1, '91113000013');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_side, v_org_id, v_asesor_a1, '91114000014');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_enviar_ok, v_org_id, v_asesor_a1, '91115000015');
  PERFORM public.__rpc_ed_test_insert_expediente(v_exp_enviar_fail, v_org_id, v_asesor_a1, '91116000016');

  -- Test 1: editor crea aprobado con monto > 0
  v_result := public.__rpc_ed_test_call_as(v_editor, v_exp_create, 'aprobado', 25000.50);
  PERFORM public.__rpc_ed_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 1: crear aprobado ok'
  );
  PERFORM public.__rpc_ed_test_assert(
    EXISTS (
      SELECT 1 FROM public.editor_decisions ed
      WHERE ed.expediente_id = v_exp_create
        AND ed.decision = 'aprobado'
        AND ed.monto_aprobado = 25000.50
        AND ed.decided_by = v_editor
    ),
    'test 1: fila editor_decisions'
  );

  -- Test 2: editor actualiza decisión existente
  PERFORM public.__rpc_ed_test_call_as(v_editor, v_exp_update, 'aprobado', 10000);
  v_result := public.__rpc_ed_test_call_as(v_editor, v_exp_update, 'aprobado', 18500);
  PERFORM public.__rpc_ed_test_assert(
    EXISTS (
      SELECT 1 FROM public.editor_decisions ed
      WHERE ed.expediente_id = v_exp_update AND ed.monto_aprobado = 18500
    ),
    'test 2: actualizar monto'
  );

  -- Test 3: cambiar aprobado a no_cumple
  PERFORM public.__rpc_ed_test_call_as(v_editor, v_exp_no_cumple, 'aprobado', 12000);
  v_result := public.__rpc_ed_test_call_as(v_editor, v_exp_no_cumple, 'no_cumple', NULL, 'no cumple criterio');
  PERFORM public.__rpc_ed_test_assert(
    (v_result->>'decision') = 'no_cumple',
    'test 3: cambio a no_cumple'
  );

  -- Test 4: no_cumple deja monto null
  PERFORM public.__rpc_ed_test_assert(
    EXISTS (
      SELECT 1 FROM public.editor_decisions ed
      WHERE ed.expediente_id = v_exp_no_cumple
        AND ed.decision = 'no_cumple'
        AND ed.monto_aprobado IS NULL
    ),
    'test 4: monto null en no_cumple'
  );

  -- Test 5: aprobado sin monto falla
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_fail(v_editor, v_exp_no_monto, 'aprobado', NULL),
    'test 5: aprobado sin monto falla'
  );

  -- Test 6: aprobado monto <= 0 falla
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_fail(v_editor, v_exp_bad_monto, 'aprobado', 0),
    'test 6: monto cero falla'
  );

  -- Test 7: asesor bloqueado
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_fail(v_asesor_a1, v_exp_asesor, 'aprobado', 1000),
    'test 7: asesor bloqueado'
  );

  -- Test 8: mesa bloqueada
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_fail(v_mesa_admin, v_exp_mesa, 'aprobado', 1000),
    'test 8: mesa bloqueada'
  );

  -- Test 9: super_admin bloqueado
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_fail(v_super, v_exp_super, 'aprobado', 1000),
    'test 9: super_admin bloqueado'
  );

  -- Test 10: otra organización falla
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_fail(v_editor, v_exp_other_org, 'aprobado', 1000),
    'test 10: otra org falla'
  );

  -- Test 11: soft-deleted falla
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_fail(v_editor, v_exp_deleted, 'aprobado', 1000),
    'test 11: deleted falla'
  );

  -- Test 12: ciclo no activo falla
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_fail(v_editor, v_exp_ciclo, 'aprobado', 1000),
    'test 12: ciclo cerrado falla'
  );

  -- Test 13: ya enviado a Mesa falla
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_fail(v_editor, v_exp_sent, 'aprobado', 1000),
    'test 13: enviado a mesa falla'
  );

  -- Test 14: action_log
  v_result := public.__rpc_ed_test_call_as(v_editor, v_exp_log, 'aprobado', 9000, 'nota revisión');
  PERFORM public.__rpc_ed_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_type = 'editor_decision'
        AND al.entity_id = v_exp_log
        AND al.action = 'editor.decision.upsert'
    ),
    'test 14: action_log'
  );

  -- Test 15-16: no cambia etapa ni submitted_to_mesa
  SELECT e.etapa_actual, e.submitted_to_mesa
  INTO v_etapa_before, v_submitted_before
  FROM public.expedientes e WHERE e.id = v_exp_side;

  v_result := public.__rpc_ed_test_call_as(v_editor, v_exp_side, 'aprobado', 11000);
  PERFORM public.__rpc_ed_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_side
        AND e.etapa_actual = v_etapa_before
        AND e.submitted_to_mesa = v_submitted_before
    ),
    'test 15-16: etapa y submitted sin cambio'
  );

  -- Test 17: enviar_a_mesa usa decisión aprobada de la RPC
  PERFORM public.__rpc_ed_test_insert_cliente(v_exp_enviar_ok, v_org_id);
  PERFORM public.__rpc_ed_test_insert_docs(v_exp_enviar_ok, v_org_id, v_asesor_a1);
  PERFORM public.__rpc_ed_test_call_as(v_editor, v_exp_enviar_ok, 'aprobado', 22000);
  v_result := public.__rpc_ed_test_call_enviar_as(v_asesor_a1, v_exp_enviar_ok);
  PERFORM public.__rpc_ed_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 17: enviar_a_mesa con decisión RPC ok'
  );

  -- Test 18: enviar_a_mesa falla con no_cumple
  PERFORM public.__rpc_ed_test_insert_cliente(v_exp_enviar_fail, v_org_id);
  PERFORM public.__rpc_ed_test_insert_docs(v_exp_enviar_fail, v_org_id, v_asesor_a1);
  PERFORM public.__rpc_ed_test_call_as(v_editor, v_exp_enviar_fail, 'no_cumple', NULL, 'rechazado');
  PERFORM public.__rpc_ed_test_assert(
    public.__rpc_ed_test_expect_enviar_fail(v_asesor_a1, v_exp_enviar_fail),
    'test 18: enviar_a_mesa falla con no_cumple'
  );

  -- Test 19: revisor no existe en app_role
  PERFORM public.__rpc_ed_test_assert(
    NOT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor'
    ),
    'test 19: revisor no existe'
  );

  RAISE NOTICE 'RPC upsert_editor_decision: 19 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_ed_test_insert_docs(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_ed_test_insert_cliente(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_ed_test_insert_expediente(UUID, UUID, UUID, CHAR, BOOLEAN, public.expediente_ciclo_estado, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.__rpc_ed_test_expect_enviar_fail(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_ed_test_call_enviar_as(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_ed_test_expect_fail(UUID, UUID, public.editor_decision, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_ed_test_call_as(UUID, UUID, public.editor_decision, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_ed_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_ed_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_ed_test_assert(BOOLEAN, TEXT);
