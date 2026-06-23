-- ConCasa CRM — pruebas P3H.2 RPC register_expediente_documento
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_register_expediente_documento.sql
-- Nota: valida metadata RPC; policies Storage se validan en migración 027 (upload real requiere JWT + bucket).

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_regdoc_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC REGDOC TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regdoc_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regdoc_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regdoc_test_storage_path(
  p_org UUID, p_exp UUID, p_tipo TEXT, p_suffix TEXT DEFAULT 'doc.pdf'
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/' || p_tipo || '/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_regdoc_test_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11),
  p_submitted BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture RegDoc',
    '5511111111', 'interno', p_submitted,
    CASE WHEN p_submitted THEN 1::smallint ELSE 1::smallint END,
    CASE WHEN p_submitted THEN 'en_validacion_mesa'::public.operativo_subestado ELSE 'pendiente'::public.operativo_subestado END,
    'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    subestado = EXCLUDED.subestado,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regdoc_test_seed_storage(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', p_path, '00000000-0000-4000-8001-000000000001')
  ON CONFLICT (bucket_id, name) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regdoc_test_call(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT,
  p_name TEXT DEFAULT 'archivo.pdf', p_mime TEXT DEFAULT 'application/pdf', p_size BIGINT DEFAULT 1024
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_regdoc_test_seed_storage(p_path);
  PERFORM public.__rpc_regdoc_test_set_auth(p_user);
  SELECT public.register_expediente_documento(
    p_exp, p_tipo, p_path, p_name, p_mime, p_size
  ) INTO v_result;
  PERFORM public.__rpc_regdoc_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regdoc_test_expect_fail(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT,
  p_contains TEXT DEFAULT NULL,
  p_mime TEXT DEFAULT 'application/pdf',
  p_size BIGINT DEFAULT 1024,
  p_seed_storage BOOLEAN DEFAULT false
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  IF p_seed_storage THEN
    PERFORM public.__rpc_regdoc_test_seed_storage(p_path);
  END IF;
  PERFORM public.__rpc_regdoc_test_set_auth(p_user);
  BEGIN
    PERFORM public.register_expediente_documento(
      p_exp, p_tipo, p_path, 'archivo.pdf', p_mime, p_size
    );
    PERFORM public.__rpc_regdoc_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_regdoc_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC REGDOC TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';

  v_exp_ok UUID := '00000000-0000-4000-9030-000000000010';
  v_exp_owner UUID := '00000000-0000-4000-9030-000000000020';
  v_exp_sent UUID := '00000000-0000-4000-9030-000000000030';
  v_exp_replace UUID := '00000000-0000-4000-9030-000000000040';
  v_exp_eight UUID := '00000000-0000-4000-9030-000000000050';

  v_path_nss TEXT;
  v_result JSONB;
  v_doc_id UUID;
  v_prev_id UUID;
  v_active_count INTEGER;
  v_deleted_count INTEGER;
  v_version INTEGER;
  v_tipo TEXT;
BEGIN
  PERFORM public.__rpc_regdoc_test_insert_exp(v_exp_ok, v_org, v_a1, '90301000010');
  PERFORM public.__rpc_regdoc_test_insert_exp(v_exp_owner, v_org, v_a2, '90302000020');
  PERFORM public.__rpc_regdoc_test_insert_exp(v_exp_sent, v_org, v_a1, '90303000030', true);
  PERFORM public.__rpc_regdoc_test_insert_exp(v_exp_replace, v_org, v_a1, '90304000040');
  PERFORM public.__rpc_regdoc_test_insert_exp(v_exp_eight, v_org, v_a1, '90305000050');

  v_path_nss := public.__rpc_regdoc_test_storage_path(v_org, v_exp_ok, 'nss', 'a1-nss.pdf');

  DELETE FROM public.expediente_documentos WHERE expediente_id IN (
    v_exp_ok, v_exp_owner, v_exp_sent, v_exp_replace, v_exp_eight
  );

  -- Test 1: asesor dueño registra OK
  v_result := public.__rpc_regdoc_test_call(v_a1, v_exp_ok, 'nss', v_path_nss);
  PERFORM public.__rpc_regdoc_test_assert((v_result->>'ok')::boolean = true, 'test 1: ok true');
  PERFORM public.__rpc_regdoc_test_assert(v_result->>'tipo_documento' = 'nss', 'test 1: tipo nss');
  PERFORM public.__rpc_regdoc_test_assert((v_result->>'version')::int = 1, 'test 1: version 1');
  PERFORM public.__rpc_regdoc_test_assert(v_result->>'estatus_revision' = 'subido', 'test 1: estatus subido');

  -- Test 2: tipo inválido rechaza (mesa — acta)
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'cliente_acta_nacimiento',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_ok, 'cliente_acta_nacimiento'),
      'tipo_documento no permitido para upload asesor'
    ),
    'test 2: acta nacimiento (Mesa) rechazada en upload asesor'
  );

  -- Test 2c: constancia SAT (Mesa) rechazada en upload asesor
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'cliente_constancia_sat',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_ok, 'cliente_constancia_sat'),
      'tipo_documento no permitido para upload asesor'
    ),
    'test 2c: constancia SAT (Mesa) rechazada en upload asesor'
  );

  -- Test 2b: legacy ine rechaza
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'ine',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_ok, 'ine'),
      'tipo_documento no permitido para upload asesor'
    ),
    'test 2b: legacy ine rechazado'
  );

  -- Test 3: rol no asesor rechaza
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(v_editor, v_exp_ok, 'nss', v_path_nss, 'rol no autorizado'),
    'test 3: editor bloqueado'
  );
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(v_mesa, v_exp_ok, 'nss', v_path_nss, 'rol no autorizado'),
    'test 3b: mesa bloqueada'
  );

  -- Test 4: asesor ajeno rechaza
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_owner, 'nss',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_owner, 'nss'),
      'solo el asesor dueño'
    ),
    'test 4: asesor ajeno'
  );

  -- Test 5: expediente ya enviado a mesa rechaza
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_sent, 'nss',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_sent, 'nss'),
      'ya fue enviado a Mesa'
    ),
    'test 5: enviado a mesa'
  );

  -- Test 6: reemplazo soft-delete + version incrementa
  v_result := public.__rpc_regdoc_test_call(
    v_a1, v_exp_replace, 'cliente_comprobante_domicilio',
    public.__rpc_regdoc_test_storage_path(v_org, v_exp_replace, 'cliente_comprobante_domicilio', 'v1.pdf')
  );
  v_prev_id := (v_result->>'documento_id')::uuid;
  v_result := public.__rpc_regdoc_test_call(
    v_a1, v_exp_replace, 'cliente_comprobante_domicilio',
    public.__rpc_regdoc_test_storage_path(v_org, v_exp_replace, 'cliente_comprobante_domicilio', 'v2.pdf')
  );
  SELECT count(*) INTO v_active_count
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_replace AND d.tipo_documento = 'cliente_comprobante_domicilio' AND d.deleted_at IS NULL;
  SELECT count(*) INTO v_deleted_count
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_replace AND d.tipo_documento = 'cliente_comprobante_domicilio' AND d.deleted_at IS NOT NULL;
  PERFORM public.__rpc_regdoc_test_assert(v_active_count = 1, 'test 6: un activo');
  PERFORM public.__rpc_regdoc_test_assert(v_deleted_count >= 1, 'test 6: soft-delete previo');
  PERFORM public.__rpc_regdoc_test_assert((v_result->>'version')::int = 2, 'test 6: version 2');

  -- Test 7: anterior rechazado → nuevo resubido
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp_replace, 'cliente_estado_cuenta',
    public.__rpc_regdoc_test_storage_path(v_org, v_exp_replace, 'cliente_estado_cuenta', 'old.pdf'),
    'old.pdf', 'application/pdf', 100, 3, 'rechazado', v_a1, 'asesor'
  );
  v_result := public.__rpc_regdoc_test_call(
    v_a1, v_exp_replace, 'cliente_estado_cuenta',
    public.__rpc_regdoc_test_storage_path(v_org, v_exp_replace, 'cliente_estado_cuenta', 'new.pdf')
  );
  PERFORM public.__rpc_regdoc_test_assert(v_result->>'estatus_revision' = 'resubido', 'test 7: resubido');

  -- Test 8–9: count presentes y completos con 5 tipos obligatorios
  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp_eight;
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    PERFORM public.__rpc_regdoc_test_call(
      v_a1, v_exp_eight, v_tipo,
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_eight, v_tipo, v_tipo || '.pdf')
    );
  END LOOP;
  PERFORM public.__rpc_regdoc_test_assert(
    public.count_integration_docs_presentes(v_exp_eight) = 5,
    'test 8: count presentes 5'
  );
  PERFORM public.__rpc_regdoc_test_assert(
    public.integration_docs_completos(v_exp_eight) = true,
    'test 9: integration_docs_completos true'
  );

  -- Test 9b: opcional semanas no cambia gate
  v_result := public.__rpc_regdoc_test_call(
    v_a1, v_exp_eight, 'cliente_semanas_cotizadas',
    public.__rpc_regdoc_test_storage_path(v_org, v_exp_eight, 'cliente_semanas_cotizadas', 'semanas.pdf')
  );
  PERFORM public.__rpc_regdoc_test_assert(
    (v_result->>'integration_docs_completos')::boolean = true,
    'test 9b: semanas opcional no cambia gate'
  );
  PERFORM public.__rpc_regdoc_test_assert(
    (v_result->>'integration_docs_presentes')::int = 5,
    'test 9b: presentes siguen en 5'
  );

  -- Test 10: storage_path con expediente distinto rechaza
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'nss',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_owner, 'nss'),
      'storage_path no coincide'
    ),
    'test 10: path expediente inválido'
  );

  -- Test 11: mime no permitido
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'nss', v_path_nss, 'mime_type no permitido',
      'text/plain', 1024, true
    ),
    'test 11: mime inválido'
  );

  -- Test 12: tamaño excedido
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'nss', v_path_nss, 'excede tamaño máximo',
      'application/pdf', (16::BIGINT * 1024 * 1024), true
    ),
    'test 12: size excedido'
  );

  -- Test 13: sin objeto en storage rechaza (anti metadata fantasma)
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'nss',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_ok, 'nss', 'ghost.pdf'),
      'objeto no encontrado en storage',
      'application/pdf', 1024, false
    ),
    'test 13: sin objeto storage'
  );

  -- Test 14: legacy estado_cuenta, direccion e historial laboral rechazan
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'estado_cuenta',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_ok, 'estado_cuenta'),
      'tipo_documento no permitido para upload asesor'
    ),
    'test 14a: legacy estado_cuenta rechazado'
  );
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'direccion',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_ok, 'direccion'),
      'tipo_documento no permitido para upload asesor'
    ),
    'test 14b: legacy direccion rechazado'
  );
  PERFORM public.__rpc_regdoc_test_assert(
    public.__rpc_regdoc_test_expect_fail(
      v_a1, v_exp_ok, 'cliente_historial_laboral',
      public.__rpc_regdoc_test_storage_path(v_org, v_exp_ok, 'cliente_historial_laboral'),
      'tipo_documento no permitido para upload asesor'
    ),
    'test 14c: historial laboral rechazado'
  );

  RAISE NOTICE 'RPC register_expediente_documento: 17 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_regdoc_test_expect_fail(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_regdoc_test_seed_storage(TEXT);
DROP FUNCTION IF EXISTS public.__rpc_regdoc_test_call(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.__rpc_regdoc_test_insert_exp(UUID, UUID, UUID, CHAR, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_regdoc_test_storage_path(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_regdoc_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_regdoc_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_regdoc_test_assert(BOOLEAN, TEXT);
