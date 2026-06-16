-- ConCasa CRM — pruebas P2C-4 RPC avanzar_etapa_operativa (solo 1→2)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_avanzar_etapa_operativa.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC AVANZAR TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_test_call_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_comentario TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_avanzar_test_set_auth(p_user_id);
  SELECT public.avanzar_etapa_operativa(p_expediente_id, p_comentario) INTO v_result;
  PERFORM public.__rpc_avanzar_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_test_call_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_comentario TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_avanzar_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(p_expediente_id, p_comentario);
    PERFORM public.__rpc_avanzar_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_avanzar_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_test_sees_expediente_as(
  p_user_id UUID,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  PERFORM public.__rpc_avanzar_test_set_auth(p_user_id);
  SELECT EXISTS (
    SELECT 1 FROM public.expedientes e WHERE e.id = p_expediente_id
  ) INTO v_found;
  PERFORM public.__rpc_avanzar_test_reset_auth();
  RETURN v_found;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_origen public.origen_mesa DEFAULT 'interno',
  p_submitted BOOLEAN DEFAULT true,
  p_etapa SMALLINT DEFAULT 1,
  p_subestado public.operativo_subestado DEFAULT 'en_validacion_mesa'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture Avanzar Etapa', '5588888888', p_origen,
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, p_subestado
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    origen_mesa = EXCLUDED.origen_mesa,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_test_insert_cliente(
  p_expediente_id UUID,
  p_org_id UUID,
  p_estado public.cliente_datos_estado DEFAULT 'validado'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado
  ) VALUES (
    p_expediente_id,
    p_org_id,
    jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Fixture Cliente'),
    p_estado
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos,
    estado = EXCLUDED.estado,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_avanzar_test_insert_docs(
  p_expediente_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_estatus_default public.estatus_revision DEFAULT 'validado',
  p_override_tipo TEXT DEFAULT NULL,
  p_override_estatus public.estatus_revision DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo TEXT;
  v_estatus public.estatus_revision;
BEGIN
  DELETE FROM public.expediente_documentos
  WHERE expediente_id = p_expediente_id
    AND tipo_documento = ANY(public.integration_doc_tipos_obligatorios());

  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_obligatorios()
  LOOP
    v_estatus := p_estatus_default;
    IF p_override_tipo IS NOT NULL AND v_tipo = p_override_tipo THEN
      v_estatus := p_override_estatus;
    END IF;

    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org_id, p_expediente_id, v_tipo,
      'dev/avanzar/' || p_expediente_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      v_estatus, p_asesor_id, 'asesor'
    );
  END LOOP;
END;
$$;

-- UUIDs dev (ver seed.sql)

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';

  v_exp_admin UUID := '00000000-0000-4000-9007-000000000010';
  v_exp_int UUID := '00000000-0000-4000-9007-000000000011';
  v_exp_int_block UUID := '00000000-0000-4000-9007-000000000012';
  v_exp_ext UUID := '00000000-0000-4000-9007-000000000013';
  v_exp_roles UUID := '00000000-0000-4000-9007-000000000014';
  v_exp_not_sent UUID := '00000000-0000-4000-9007-000000000015';
  v_exp_wrong_etapa UUID := '00000000-0000-4000-9007-000000000016';
  v_exp_subido UUID := '00000000-0000-4000-9007-000000000017';
  v_exp_rechazado UUID := '00000000-0000-4000-9007-000000000018';
  v_exp_optional UUID := '00000000-0000-4000-9007-000000000019';
  v_exp_double UUID := '00000000-0000-4000-9007-000000000020';
  v_exp_vis UUID := '00000000-0000-4000-9007-000000000021';

  v_result JSONB;
  v_log_before BIGINT;
  v_log_after BIGINT;
BEGIN
  -- Expedientes listos para avance 1→2
  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_admin, v_org_id, v_asesor_a1, '90701000001', 'interno');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_admin, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_admin, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_int, v_org_id, v_asesor_a1, '90701100011', 'interno');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_int, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_int, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_int_block, v_org_id, v_asesor_a1, '90701200012', 'interno');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_int_block, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_int_block, v_org_id, v_asesor_a1);

  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_ext, v_org_id, v_asesor_a2, '90701300013', 'externo');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_ext, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_ext, v_org_id, v_asesor_a2);

  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_roles, v_org_id, v_asesor_a1, '90701400014', 'interno');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_roles, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_roles, v_org_id, v_asesor_a1);

  -- No enviado a Mesa
  PERFORM public.__rpc_avanzar_test_insert_expediente(
    v_exp_not_sent, v_org_id, v_asesor_a1, '90701500015',
    'interno'::public.origen_mesa, false, 1::smallint, 'pendiente'::public.operativo_subestado
  );
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_not_sent, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_not_sent, v_org_id, v_asesor_a1);

  -- Etapa distinta de 1
  PERFORM public.__rpc_avanzar_test_insert_expediente(
    v_exp_wrong_etapa, v_org_id, v_asesor_a1, '90701600016',
    'interno'::public.origen_mesa, true, 2::smallint, 'en_proceso'::public.operativo_subestado
  );
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_wrong_etapa, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_wrong_etapa, v_org_id, v_asesor_a1);

  -- Documento subido
  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_subido, v_org_id, v_asesor_a1, '90701700017', 'interno');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_subido, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_subido, v_org_id, v_asesor_a1, 'validado', 'ine', 'subido');

  -- Documento rechazado
  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_rechazado, v_org_id, v_asesor_a1, '90701800018', 'interno');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_rechazado, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_rechazado, v_org_id, v_asesor_a1, 'validado', 'nss', 'rechazado');

  -- Sin docs opcionales (solo obligatorios validados)
  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_optional, v_org_id, v_asesor_a1, '90701900019', 'interno');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_optional, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_optional, v_org_id, v_asesor_a1);

  -- Doble avance
  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_double, v_org_id, v_asesor_a1, '90702000020', 'interno');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_double, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_double, v_org_id, v_asesor_a1);

  -- Visibilidad post-avance
  PERFORM public.__rpc_avanzar_test_insert_expediente(v_exp_vis, v_org_id, v_asesor_a1, '90702100021', 'interno');
  PERFORM public.__rpc_avanzar_test_insert_cliente(v_exp_vis, v_org_id);
  PERFORM public.__rpc_avanzar_test_insert_docs(v_exp_vis, v_org_id, v_asesor_a1);

  -- Test 1: mesa_admin avanza expediente interno validado
  v_result := public.__rpc_avanzar_test_call_as(v_mesa_admin, v_exp_admin, 'integración aprobada');
  PERFORM public.__rpc_avanzar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 1: mesa_admin ok'
  );
  PERFORM public.__rpc_avanzar_test_assert(
    (v_result->>'etapa_actual')::int = 2,
    'test 1: etapa 2'
  );

  -- Test 2: mesa_interno avanza expediente interno
  v_result := public.__rpc_avanzar_test_call_as(v_mesa_int, v_exp_int);
  PERFORM public.__rpc_avanzar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 2: mesa_interno ok'
  );

  -- Test 3: mesa_externo NO avanza expediente interno
  PERFORM public.__rpc_avanzar_test_assert(
    public.__rpc_avanzar_test_call_expect_fail(v_mesa_ext, v_exp_int_block),
    'test 3: mesa_externo bloqueado en interno'
  );

  -- Test 4: mesa_externo avanza expediente externo
  v_result := public.__rpc_avanzar_test_call_as(v_mesa_ext, v_exp_ext);
  PERFORM public.__rpc_avanzar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 4: mesa_externo ok en externo'
  );

  -- Test 5: asesor NO puede avanzar
  PERFORM public.__rpc_avanzar_test_assert(
    public.__rpc_avanzar_test_call_expect_fail(v_asesor_a1, v_exp_roles),
    'test 5: asesor bloqueado'
  );

  -- Test 6: editor NO puede avanzar
  PERFORM public.__rpc_avanzar_test_assert(
    public.__rpc_avanzar_test_call_expect_fail(v_editor, v_exp_roles),
    'test 6: editor bloqueado'
  );

  -- Test 7: no enviado a Mesa falla
  PERFORM public.__rpc_avanzar_test_assert(
    public.__rpc_avanzar_test_call_expect_fail(v_mesa_admin, v_exp_not_sent),
    'test 7: no enviado falla'
  );

  -- Test 8: etapa distinta de 1 falla
  PERFORM public.__rpc_avanzar_test_assert(
    public.__rpc_avanzar_test_call_expect_fail(v_mesa_admin, v_exp_wrong_etapa),
    'test 8: etapa != 1 falla'
  );

  -- Test 9: documento subido falla
  PERFORM public.__rpc_avanzar_test_assert(
    public.__rpc_avanzar_test_call_expect_fail(v_mesa_admin, v_exp_subido),
    'test 9: doc subido falla'
  );

  -- Test 10: documento rechazado falla
  PERFORM public.__rpc_avanzar_test_assert(
    public.__rpc_avanzar_test_call_expect_fail(v_mesa_admin, v_exp_rechazado),
    'test 10: doc rechazado falla'
  );

  -- Test 11: sin opcionales sí puede avanzar
  v_result := public.__rpc_avanzar_test_call_as(v_mesa_admin, v_exp_optional);
  PERFORM public.__rpc_avanzar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 11: sin opcionales ok'
  );

  -- Test 12: estado post-avance 1→2 (v_exp_admin ya avanzado)
  PERFORM public.__rpc_avanzar_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_admin
        AND e.etapa_actual = 2
        AND e.subestado = 'en_proceso'
    ),
    'test 12: etapa 2 / en_proceso'
  );

  -- Test 13: action_log
  PERFORM public.__rpc_avanzar_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_type = 'expediente'
        AND al.entity_id = v_exp_admin
        AND al.action = 'expediente.avanzar_etapa_operativa'
    ),
    'test 13: action_log creado'
  );

  -- Test 14: segundo avance falla sin duplicar action_log
  SELECT count(*) INTO v_log_before
  FROM public.action_log
  WHERE entity_id = v_exp_double AND action = 'expediente.avanzar_etapa_operativa';

  v_result := public.__rpc_avanzar_test_call_as(v_mesa_admin, v_exp_double);
  PERFORM public.__rpc_avanzar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 14: primer avance double ok'
  );

  PERFORM public.__rpc_avanzar_test_assert(
    public.__rpc_avanzar_test_call_expect_fail(v_mesa_admin, v_exp_double),
    'test 14: segundo avance falla'
  );

  SELECT count(*) INTO v_log_after
  FROM public.action_log
  WHERE entity_id = v_exp_double AND action = 'expediente.avanzar_etapa_operativa';

  PERFORM public.__rpc_avanzar_test_assert(
    v_log_after = v_log_before + 1,
    'test 14: no duplica action_log'
  );

  -- Test 15: visibilidad por origen tras avance
  v_result := public.__rpc_avanzar_test_call_as(v_mesa_int, v_exp_vis);
  PERFORM public.__rpc_avanzar_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 15: avance visibilidad ok'
  );
  PERFORM public.__rpc_avanzar_test_assert(
    public.__rpc_avanzar_test_sees_expediente_as(v_mesa_int, v_exp_vis),
    'test 15: mesa_interno ve expediente interno'
  );
  PERFORM public.__rpc_avanzar_test_assert(
    NOT public.__rpc_avanzar_test_sees_expediente_as(v_mesa_ext, v_exp_vis),
    'test 15: mesa_externo no ve expediente interno'
  );

  RAISE NOTICE 'RPC avanzar_etapa_operativa: 15 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_avanzar_test_insert_docs(UUID, UUID, UUID, public.estatus_revision, TEXT, public.estatus_revision);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_test_insert_cliente(UUID, UUID, public.cliente_datos_estado);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_test_insert_expediente(UUID, UUID, UUID, CHAR, public.origen_mesa, BOOLEAN, SMALLINT, public.operativo_subestado);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_test_sees_expediente_as(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_test_call_expect_fail(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_test_call_as(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_avanzar_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_avanzar_test_assert(BOOLEAN, TEXT);
