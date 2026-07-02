-- ConCasa CRM — pruebas P2C-3 RPC enviar_a_mesa
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_enviar_a_mesa.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC ENVIAR TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_call_as(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_enviar_test_set_auth(p_user_id);
  SELECT public.enviar_a_mesa(p_expediente_id) INTO v_result;
  PERFORM public.__rpc_enviar_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_call_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_enviar_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.enviar_a_mesa(p_expediente_id);
    PERFORM public.__rpc_enviar_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_enviar_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_sees_expediente_as(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  PERFORM public.__rpc_enviar_test_set_auth(p_user_id);
  SELECT EXISTS (
    SELECT 1 FROM public.expedientes e WHERE e.id = p_expediente_id
  ) INTO v_found;
  PERFORM public.__rpc_enviar_test_reset_auth();
  RETURN v_found;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_origen public.origen_mesa DEFAULT 'interno'
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
    'Fixture Enviar Mesa', '5599999999', p_origen, false, 1, 'pendiente'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    origen_mesa = EXCLUDED.origen_mesa,
    submitted_to_mesa = false,
    fecha_envio_mesa = NULL,
    etapa_actual = 1,
    subestado = 'pendiente',
    deleted_at = NULL,
    ciclo_estado = 'activo',
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_insert_editor(
  p_expediente_id UUID,
  p_org_id UUID,
  p_decision public.editor_decision DEFAULT 'aprobado',
  p_monto NUMERIC DEFAULT 15000
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado
  ) VALUES (
    p_expediente_id, p_org_id, p_decision, p_monto
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    decision = EXCLUDED.decision,
    monto_aprobado = EXCLUDED.monto_aprobado,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_insert_cliente(
  p_expediente_id UUID,
  p_org_id UUID,
  p_rfc TEXT DEFAULT 'XAXX010101000',
  p_estado public.cliente_datos_estado DEFAULT 'completo',
  p_porcentaje_cobro NUMERIC DEFAULT 10,
  p_monto_calculado NUMERIC DEFAULT 1500,
  p_metodo_pago TEXT DEFAULT 'transferencia'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    p_expediente_id,
    p_org_id,
    jsonb_build_object('rfc', p_rfc, 'nombreCliente', 'Fixture Cliente'),
    p_estado,
    p_porcentaje_cobro,
    p_monto_calculado,
    p_metodo_pago
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

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_insert_docs_obligatorios(
  p_expediente_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_include_opcionales BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo TEXT;
BEGIN
  DELETE FROM public.expediente_documentos
  WHERE expediente_id = p_expediente_id
    AND (
      tipo_documento = ANY(public.integration_doc_tipos_obligatorios())
      OR tipo_documento IN ('cliente_semanas_cotizadas', 'cliente_historial_laboral')
    );

  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_obligatorios()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org_id, p_expediente_id, v_tipo,
      'dev/enviar/' || p_expediente_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor_id, 'asesor'
    );
  END LOOP;

  IF p_include_opcionales THEN
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org_id, p_expediente_id, 'cliente_semanas_cotizadas',
      'dev/enviar/opcional.pdf', 'opcional.pdf', 'application/pdf', 100,
      'subido', p_asesor_id, 'asesor'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_enviar_test_insert_docs_asesor_envio(
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
    AND (
      tipo_documento = ANY(public.integration_doc_tipos_obligatorios())
      OR tipo_documento IN ('cliente_semanas_cotizadas', 'cliente_historial_laboral')
    );

  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org_id, p_expediente_id, v_tipo,
      'dev/enviar/' || p_expediente_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor_id, 'asesor'
    );
  END LOOP;
END;
$$;

-- UUIDs dev (ver seed.sql)
-- asesor_interno  00000000-0000-4000-8001-000000000001
-- asesor_externo  00000000-0000-4000-8001-000000000002
-- editor          00000000-0000-4000-8002-000000000001
-- mesa_interno    00000000-0000-4000-8004-000000000001
-- mesa_externo    00000000-0000-4000-8005-000000000001

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';

  v_exp_ok UUID := '00000000-0000-4000-9005-000000000010';
  v_exp_other UUID := '00000000-0000-4000-9005-000000000020';
  v_exp_no_editor UUID := '00000000-0000-4000-9005-000000000030';
  v_exp_editor_pend UUID := '00000000-0000-4000-9005-000000000031';
  v_exp_editor_rech UUID := '00000000-0000-4000-9005-000000000032';
  v_exp_no_rfc UUID := '00000000-0000-4000-9005-000000000040';
  v_exp_no_datos UUID := '00000000-0000-4000-9005-000000000050';
  v_exp_no_docs UUID := '00000000-0000-4000-9005-000000000060';
  v_exp_optional UUID := '00000000-0000-4000-9005-000000000070';
  v_exp_double UUID := '00000000-0000-4000-9005-000000000080';
  v_exp_vis UUID := '00000000-0000-4000-9005-000000000090';
  v_exp_solo_asesor UUID := '00000000-0000-4000-9005-000000000091';
  v_exp_no_cobro UUID := '00000000-0000-4000-9005-000000000092';

  v_result JSONB;
  v_log_before BIGINT;
  v_log_after BIGINT;
BEGIN
  -- Expediente listo para envío (asesor a1)
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_ok, v_org_id, v_asesor_a1, '90501000001');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_ok, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_ok, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_ok, v_org_id, v_asesor_a1);

  -- Expediente de otro asesor (a2)
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_other, v_org_id, v_asesor_a2, '90502000002');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_other, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_other, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_other, v_org_id, v_asesor_a2);

  -- Sin decisión editor
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_no_editor, v_org_id, v_asesor_a1, '90503000003');
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_no_editor, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_no_editor, v_org_id, v_asesor_a1);
  DELETE FROM public.editor_decisions WHERE expediente_id = v_exp_no_editor;

  -- Decisión pendiente / rechazada
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_editor_pend, v_org_id, v_asesor_a1, '90503100031');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_editor_pend, v_org_id, 'pendiente', 100);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_editor_pend, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_editor_pend, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_editor_rech, v_org_id, v_asesor_a1, '90503200032');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_editor_rech, v_org_id, 'no_cumple', 100);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_editor_rech, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_editor_rech, v_org_id, v_asesor_a1);

  -- Sin RFC
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_no_rfc, v_org_id, v_asesor_a1, '90504000004');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_no_rfc, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_no_rfc, v_org_id, '', 'completo');
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_no_rfc, v_org_id, v_asesor_a1);

  -- Sin cliente_datos
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_no_datos, v_org_id, v_asesor_a1, '90505000005');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_no_datos, v_org_id);
  DELETE FROM public.cliente_datos WHERE expediente_id = v_exp_no_datos;
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_no_datos, v_org_id, v_asesor_a1);

  -- Sin documentos obligatorios
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_no_docs, v_org_id, v_asesor_a1, '90506000006');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_no_docs, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_no_docs, v_org_id);
  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp_no_docs;

  -- Solo obligatorios (sin opcionales)
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_optional, v_org_id, v_asesor_a1, '90507000007');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_optional, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_optional, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_optional, v_org_id, v_asesor_a1, false);

  -- Doble envío
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_double, v_org_id, v_asesor_a1, '90508000008');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_double, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_double, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_double, v_org_id, v_asesor_a1);

  -- Visibilidad Mesa post-envío (interno)
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_vis, v_org_id, v_asesor_a1, '90509000009', 'interno');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_vis, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_vis, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_vis, v_org_id, v_asesor_a1);

  -- Solo 4 docs asesor (sin nss, acta ni constancia SAT)
  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_solo_asesor, v_org_id, v_asesor_a1, '90509100091');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_solo_asesor, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_solo_asesor, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_docs_asesor_envio(v_exp_solo_asesor, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_enviar_test_insert_expediente(v_exp_no_cobro, v_org_id, v_asesor_a1, '90509200092');
  PERFORM public.__rpc_enviar_test_insert_editor(v_exp_no_cobro, v_org_id);
  PERFORM public.__rpc_enviar_test_insert_cliente(v_exp_no_cobro, v_org_id, '', 'completo');
  UPDATE public.cliente_datos
  SET porcentaje_cobro = NULL, monto_calculado = NULL, metodo_pago = NULL
  WHERE expediente_id = v_exp_no_cobro;
  PERFORM public.__rpc_enviar_test_insert_docs_obligatorios(v_exp_no_cobro, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_enviar_test_assert(
    NOT public.__rpc_enviar_test_sees_expediente_as(v_mesa_int, v_exp_vis),
    'pre-envío: mesa_interno no ve borrador no enviado'
  );

  -- Test 1: asesor dueño envía expediente completo
  v_result := public.__rpc_enviar_test_call_as(v_asesor_a1, v_exp_ok);
  PERFORM public.__rpc_enviar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 1: ok=true'
  );
  PERFORM public.__rpc_enviar_test_assert(
    (v_result->>'enviado_a_mesa')::boolean = true,
    'test 1: enviado_a_mesa=true'
  );
  PERFORM public.__rpc_enviar_test_assert(
    (v_result->>'documentos_obligatorios_count')::int = 4,
    'test 1: 4 documentos asesor para envío'
  );

  -- Test 2: asesor no envía expediente ajeno
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_asesor_a1, v_exp_other),
    'test 2: asesor no envía expediente de otro asesor'
  );

  -- Test 3: editor no puede enviar
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_editor, v_exp_other),
    'test 3: editor bloqueado'
  );

  -- Test 4: mesa no puede enviar
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_mesa_int, v_exp_other),
    'test 4: mesa_interno bloqueado'
  );

  -- Test 5: sin decisión editor
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_asesor_a1, v_exp_no_editor),
    'test 5: sin decisión editor falla'
  );

  -- Test 6: decisión pendiente / rechazada
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_asesor_a1, v_exp_editor_pend),
    'test 6a: decisión pendiente falla'
  );
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_asesor_a1, v_exp_editor_rech),
    'test 6b: decisión no_cumple falla'
  );

  -- Test 7: sin RFC puede enviar
  v_result := public.__rpc_enviar_test_call_as(v_asesor_a1, v_exp_no_rfc);
  PERFORM public.__rpc_enviar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 7: sin RFC puede enviar'
  );

  -- Test 8: sin datos cliente
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_asesor_a1, v_exp_no_datos),
    'test 8: sin cliente_datos falla'
  );

  -- Test 9: sin documentos obligatorios
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_asesor_a1, v_exp_no_docs),
    'test 9: sin docs obligatorios falla'
  );

  -- Test 10: sin docs opcionales sí puede enviar
  v_result := public.__rpc_enviar_test_call_as(v_asesor_a1, v_exp_optional);
  PERFORM public.__rpc_enviar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 10: sin opcionales puede enviar'
  );

  -- Test 11: estado post-envío (exp_ok ya enviado en test 1)
  PERFORM public.__rpc_enviar_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_ok
        AND e.etapa_actual = 1
        AND e.subestado = 'en_validacion_mesa'
        AND e.submitted_to_mesa = true
        AND e.fecha_envio_mesa IS NOT NULL
    ),
    'test 11: expediente en etapa 1 / en_validacion_mesa'
  );

  -- Test 12: action_log en envío exitoso
  PERFORM public.__rpc_enviar_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_type = 'expediente'
        AND al.entity_id = v_exp_ok
        AND al.action = 'expediente.enviar_a_mesa'
    ),
    'test 12: action_log expediente.enviar_a_mesa'
  );

  -- Test 13: segundo envío falla sin duplicar action_log
  SELECT count(*) INTO v_log_before
  FROM public.action_log
  WHERE entity_id = v_exp_double AND action = 'expediente.enviar_a_mesa';

  v_result := public.__rpc_enviar_test_call_as(v_asesor_a1, v_exp_double);
  PERFORM public.__rpc_enviar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 13: primer envío double ok'
  );

  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_asesor_a1, v_exp_double),
    'test 13: segundo envío falla'
  );

  SELECT count(*) INTO v_log_after
  FROM public.action_log
  WHERE entity_id = v_exp_double AND action = 'expediente.enviar_a_mesa';

  PERFORM public.__rpc_enviar_test_assert(
    v_log_after = v_log_before + 1,
    'test 13: no duplica action_log en reenvío'
  );

  -- Test 14: visibilidad Mesa según origen tras envío
  v_result := public.__rpc_enviar_test_call_as(v_asesor_a1, v_exp_vis);
  PERFORM public.__rpc_enviar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 14: envío visibilidad ok'
  );
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_sees_expediente_as(v_mesa_int, v_exp_vis),
    'test 14: mesa_interno ve expediente interno enviado'
  );
  PERFORM public.__rpc_enviar_test_assert(
    NOT public.__rpc_enviar_test_sees_expediente_as(v_mesa_ext, v_exp_vis),
    'test 14: mesa_externo no ve expediente interno'
  );

  -- Test 15: envío con solo 4 docs asesor (sin nss/acta/constancia SAT)
  v_result := public.__rpc_enviar_test_call_as(v_asesor_a1, v_exp_solo_asesor);
  PERFORM public.__rpc_enviar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 15: solo 4 docs asesor puede enviar'
  );
  PERFORM public.__rpc_enviar_test_assert(
    (v_result->>'documentos_obligatorios_count')::int = 4,
    'test 15: documentos_obligatorios_count=4'
  );

  -- Test 16: sin campos de cobro bloquea envío
  PERFORM public.__rpc_enviar_test_assert(
    public.__rpc_enviar_test_call_expect_fail(v_asesor_a1, v_exp_no_cobro),
    'test 16: sin cobro falla'
  );

  RAISE NOTICE 'RPC enviar_a_mesa: 16 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_enviar_test_insert_docs_asesor_envio(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_insert_docs_obligatorios(UUID, UUID, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_insert_cliente(UUID, UUID, TEXT, public.cliente_datos_estado, NUMERIC, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_insert_editor(UUID, UUID, public.editor_decision, NUMERIC);
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_insert_expediente(UUID, UUID, UUID, CHAR, public.origen_mesa);
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_sees_expediente_as(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_call_expect_fail(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_call_as(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_enviar_test_assert(BOOLEAN, TEXT);
