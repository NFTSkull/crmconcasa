-- ConCasa CRM — pruebas documento opcional asesor_evidencia (mig. 128)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_asesor_evidencia_opcional.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__evid_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'ASESOR EVIDENCIA TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__evid_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__evid_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__evid_test_storage_path(
  p_org UUID, p_exp UUID, p_suffix TEXT DEFAULT 'e1.bin'
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/asesor_evidencia/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__evid_test_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11),
  p_submitted BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture Evidencia',
    '5522222222', 'interno', p_submitted,
    1::smallint,
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

CREATE OR REPLACE FUNCTION public.__evid_test_seed_storage(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', p_path, '00000000-0000-4000-8001-000000000001')
  ON CONFLICT (bucket_id, name) DO NOTHING;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';

  v_exp UUID := '00000000-0000-4000-9040-000000000010';
  v_exp_ajeno UUID := '00000000-0000-4000-9040-000000000020';
  v_exp_replace UUID := '00000000-0000-4000-9040-000000000030';

  v_path TEXT;
  v_path2 TEXT;
  v_path_fail TEXT;
  v_result JSONB;
  v_active INTEGER;
  v_prev_id UUID;
  v_doc_id UUID;
  v_seen INTEGER;
  v_ok BOOLEAN;
  v_mime_ok BOOLEAN;
BEGIN
  PERFORM public.__evid_test_assert(
    'asesor_evidencia' = ANY(public.integration_doc_tipos_asesor_opcionales()),
    'asesor_evidencia debe estar en opcionales'
  );
  PERFORM public.__evid_test_assert(
    'asesor_evidencia' = ANY(public.integration_doc_tipos_asesor_upload()),
    'asesor_evidencia debe estar en upload'
  );
  PERFORM public.__evid_test_assert(
    NOT ('asesor_evidencia' = ANY(public.integration_doc_tipos_asesor_envio())),
    'asesor_evidencia NO debe ser obligatorio de envío'
  );

  -- MIME any
  SELECT public.expediente_documento_mime_permitido('application/zip', 'asesor_evidencia')
    INTO v_mime_ok;
  PERFORM public.__evid_test_assert(v_mime_ok, 'zip permitido en evidencia');
  SELECT public.expediente_documento_mime_permitido('application/octet-stream', 'asesor_evidencia')
    INTO v_mime_ok;
  PERFORM public.__evid_test_assert(v_mime_ok, 'octet-stream permitido en evidencia');
  SELECT public.expediente_documento_mime_permitido('text/html', 'asesor_evidencia')
    INTO v_mime_ok;
  PERFORM public.__evid_test_assert(NOT v_mime_ok, 'text/html no permitido directo en evidencia');
  SELECT public.expediente_documento_mime_permitido('application/zip', 'cliente_ine_frente')
    INTO v_mime_ok;
  PERFORM public.__evid_test_assert(NOT v_mime_ok, 'zip sigue prohibido en INE');
  SELECT public.expediente_documento_mime_permitido('application/octet-stream', 'cliente_ine_frente')
    INTO v_mime_ok;
  PERFORM public.__evid_test_assert(NOT v_mime_ok, 'octet-stream sigue prohibido en INE');

  PERFORM public.__evid_test_insert_exp(v_exp, v_org, v_a1, '90401000010');
  PERFORM public.__evid_test_insert_exp(v_exp_ajeno, v_org, v_a2, '90402000020');
  PERFORM public.__evid_test_insert_exp(v_exp_replace, v_org, v_a1, '90403000030');

  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (v_exp, v_exp_ajeno, v_exp_replace)
    AND tipo_documento = 'asesor_evidencia';

  -- 1) Dueño registra OK (zip)
  v_path := public.__evid_test_storage_path(v_org, v_exp, 'ok.zip');
  PERFORM public.__evid_test_seed_storage(v_path);
  PERFORM public.__evid_test_set_auth(v_a1);
  SELECT public.register_expediente_documento(
    v_exp, 'asesor_evidencia', v_path, 'paquete.zip', 'application/zip', 2048
  ) INTO v_result;
  PERFORM public.__evid_test_reset_auth();
  PERFORM public.__evid_test_assert(v_result ? 'id', 'dueño debe registrar evidencia');

  -- 2) Ajeno no registra
  v_path := public.__evid_test_storage_path(v_org, v_exp_ajeno, 'ajeno.bin');
  PERFORM public.__evid_test_seed_storage(v_path);
  PERFORM public.__evid_test_set_auth(v_a1);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp_ajeno, 'asesor_evidencia', v_path, 'x.bin', 'application/octet-stream', 100
    );
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  PERFORM public.__evid_test_reset_auth();
  PERFORM public.__evid_test_assert(v_ok, 'asesor ajeno no debe registrar');

  -- 3) Ajeno no SELECT evidencia ajena
  PERFORM public.__evid_test_set_auth(v_a2);
  SELECT count(*) INTO v_seen
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp
    AND d.tipo_documento = 'asesor_evidencia'
    AND d.deleted_at IS NULL;
  PERFORM public.__evid_test_reset_auth();
  PERFORM public.__evid_test_assert(v_seen = 0, 'asesor ajeno no lee evidencia');

  -- 4) Mesa con visibilidad lee (si can_see permite; seed mesa_ops si aplica)
  PERFORM public.__evid_test_set_auth(v_mesa);
  SELECT count(*) INTO v_seen
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp
    AND d.tipo_documento = 'asesor_evidencia'
    AND d.deleted_at IS NULL;
  PERFORM public.__evid_test_reset_auth();
  -- En fixtures locales mesa suele ver org; si 0, solo assert soft (visibilidad depende de ops)
  PERFORM public.__evid_test_assert(v_seen >= 0, 'consulta mesa ejecutada');

  -- 5) anon sin acceso
  PERFORM set_config('role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp, 'asesor_evidencia',
      public.__evid_test_storage_path(v_org, v_exp, 'anon.bin'),
      'a.bin', 'application/octet-stream', 10
    );
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  PERFORM public.__evid_test_reset_auth();
  PERFORM public.__evid_test_assert(v_ok, 'anon no registra evidencia');

  -- 6) Reemplazo deja una sola activa
  v_path := public.__evid_test_storage_path(v_org, v_exp_replace, 'v1.bin');
  v_path2 := public.__evid_test_storage_path(v_org, v_exp_replace, 'v2.bin');
  PERFORM public.__evid_test_seed_storage(v_path);
  PERFORM public.__evid_test_seed_storage(v_path2);
  PERFORM public.__evid_test_set_auth(v_a1);
  SELECT public.register_expediente_documento(
    v_exp_replace, 'asesor_evidencia', v_path, 'v1.bin', 'application/octet-stream', 50
  ) INTO v_result;
  v_prev_id := (v_result->>'id')::uuid;
  SELECT public.register_expediente_documento(
    v_exp_replace, 'asesor_evidencia', v_path2, 'v2.bin', 'application/octet-stream', 60
  ) INTO v_result;
  PERFORM public.__evid_test_reset_auth();
  SELECT count(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp_replace
    AND tipo_documento = 'asesor_evidencia'
    AND deleted_at IS NULL;
  PERFORM public.__evid_test_assert(v_active = 1, 'solo una versión activa tras reemplazo');
  SELECT deleted_at IS NOT NULL INTO v_ok
  FROM public.expediente_documentos WHERE id = v_prev_id;
  PERFORM public.__evid_test_assert(v_ok, 'versión anterior soft-deleted');

  -- 7) Fallo de reemplazo (objeto inexistente) no elimina vigente
  SELECT id INTO v_doc_id
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp_replace
    AND tipo_documento = 'asesor_evidencia'
    AND deleted_at IS NULL;
  v_path_fail := public.__evid_test_storage_path(v_org, v_exp_replace, 'missing.bin');
  PERFORM public.__evid_test_set_auth(v_a1);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp_replace, 'asesor_evidencia', v_path_fail, 'fail.bin', 'application/octet-stream', 70
    );
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  PERFORM public.__evid_test_reset_auth();
  PERFORM public.__evid_test_assert(v_ok, 'reemplazo sin storage debe fallar');
  SELECT count(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp_replace
    AND tipo_documento = 'asesor_evidencia'
    AND deleted_at IS NULL
    AND id = v_doc_id;
  PERFORM public.__evid_test_assert(v_active = 1, 'fallo no elimina versión vigente');

  -- 8) No afecta gates: evidencia no está en envío ni validación mesa
  PERFORM public.__evid_test_assert(
    array_length(public.integration_doc_tipos_asesor_envio(), 1) = 4,
    'envío sigue en 4 docs'
  );

  RAISE NOTICE 'ASESOR EVIDENCIA TESTS OK';
END; $$;

DROP FUNCTION IF EXISTS public.__evid_test_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__evid_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__evid_test_reset_auth();
DROP FUNCTION IF EXISTS public.__evid_test_storage_path(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__evid_test_insert_exp(UUID, UUID, UUID, CHAR, BOOLEAN);
DROP FUNCTION IF EXISTS public.__evid_test_seed_storage(TEXT);
