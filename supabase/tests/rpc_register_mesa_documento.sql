-- ConCasa CRM — pruebas P3J.5 RPC register_mesa_documento
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_register_mesa_documento.sql

\set ON_ERROR_STOP on

DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_insert_exp(UUID, UUID, UUID, public.origen_mesa, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_insert_exp(UUID, UUID, UUID, public.origen_mesa, BOOLEAN, CHAR);
DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_insert_exp(UUID, UUID, UUID, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.__rpc_mdoc_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC MDOC TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_mdoc_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_mdoc_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_mdoc_test_storage_path(
  p_org UUID, p_exp UUID, p_tipo TEXT, p_suffix TEXT DEFAULT 'doc.pdf'
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/' || p_tipo || '/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mdoc_test_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_origen public.origen_mesa,
  p_submitted BOOLEAN DEFAULT true, p_nss CHAR(11) DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_nss CHAR(11);
BEGIN
  v_nss := COALESCE(p_nss, right('00000000000' || replace(p_id::text, '-', ''), 11)::char(11));
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', v_nss, 'Fixture Mesa Doc',
    '5511111111', p_origen,
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    1,
    CASE WHEN p_submitted THEN 'en_validacion_mesa'::public.operativo_subestado ELSE 'pendiente'::public.operativo_subestado END,
    'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    origen_mesa = EXCLUDED.origen_mesa,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    subestado = EXCLUDED.subestado,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_mdoc_test_seed_storage(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', p_path, '00000000-0000-4000-8003-000000000001')
  ON CONFLICT (bucket_id, name) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_mdoc_test_call(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT,
  p_seed BOOLEAN DEFAULT true
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_seed THEN
    PERFORM public.__rpc_mdoc_test_seed_storage(p_path);
  END IF;
  PERFORM public.__rpc_mdoc_test_set_auth(p_user);
  SELECT public.register_mesa_documento(
    p_exp, p_tipo, p_path, 'archivo.pdf', 'application/pdf', 1024
  ) INTO v_result;
  PERFORM public.__rpc_mdoc_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_mdoc_test_expect_fail(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT,
  p_contains TEXT DEFAULT NULL, p_seed BOOLEAN DEFAULT true
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  IF p_seed THEN
    PERFORM public.__rpc_mdoc_test_seed_storage(p_path);
  END IF;
  PERFORM public.__rpc_mdoc_test_set_auth(p_user);
  BEGIN
    PERFORM public.register_mesa_documento(
      p_exp, p_tipo, p_path, 'archivo.pdf', 'application/pdf', 1024
    );
    PERFORM public.__rpc_mdoc_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_mdoc_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC MDOC TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';

  v_exp_int UUID := '00000000-0000-4000-9032-000000000010';
  v_exp_ext UUID := '00000000-0000-4000-9032-000000000020';
  v_exp_not_sent UUID := '00000000-0000-4000-9032-000000000030';
  v_exp_replace UUID := '00000000-0000-4000-9032-000000000040';

  v_path_semanas TEXT;
  v_path_acta TEXT;
  v_path_sat TEXT;
  v_path_nss TEXT;
  v_result JSONB;
  v_active_count INTEGER;
  v_deleted_count INTEGER;
  v_log_count INTEGER;
BEGIN
  PERFORM public.__rpc_mdoc_test_insert_exp(v_exp_int, v_org, v_asesor, 'interno'::public.origen_mesa, true, '90321000001');
  PERFORM public.__rpc_mdoc_test_insert_exp(v_exp_ext, v_org, v_asesor, 'externo'::public.origen_mesa, true, '90321000002');
  PERFORM public.__rpc_mdoc_test_insert_exp(v_exp_not_sent, v_org, v_asesor, 'interno'::public.origen_mesa, false, '90321000003');
  PERFORM public.__rpc_mdoc_test_insert_exp(v_exp_replace, v_org, v_asesor, 'interno'::public.origen_mesa, true, '90321000004');

  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (v_exp_int, v_exp_ext, v_exp_not_sent, v_exp_replace);

  v_path_semanas := public.__rpc_mdoc_test_storage_path(v_org, v_exp_int, 'cliente_semanas_cotizadas', 'sem.pdf');
  v_path_acta := public.__rpc_mdoc_test_storage_path(v_org, v_exp_int, 'cliente_acta_nacimiento', 'acta.pdf');
  v_path_sat := public.__rpc_mdoc_test_storage_path(v_org, v_exp_int, 'cliente_constancia_sat', 'sat.pdf');
  v_path_nss := public.__rpc_mdoc_test_storage_path(v_org, v_exp_int, 'nss', 'nss.pdf');

  -- 1. mesa_admin sube semanas, acta y constancia SAT
  v_result := public.__rpc_mdoc_test_call(v_mesa_admin, v_exp_int, 'cliente_semanas_cotizadas', v_path_semanas);
  PERFORM public.__rpc_mdoc_test_assert((v_result->>'ok')::boolean = true, 'test 1a: semanas ok');
  v_result := public.__rpc_mdoc_test_call(v_mesa_admin, v_exp_int, 'cliente_acta_nacimiento', v_path_acta);
  PERFORM public.__rpc_mdoc_test_assert(v_result->>'tipo_documento' = 'cliente_acta_nacimiento', 'test 1b: acta');
  v_result := public.__rpc_mdoc_test_call(v_mesa_admin, v_exp_int, 'cliente_constancia_sat', v_path_sat);
  PERFORM public.__rpc_mdoc_test_assert(v_result->>'tipo_documento' = 'cliente_constancia_sat', 'test 1c: sat');

  -- 2. mesa_interno sube en expediente interno
  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp_replace;
  v_result := public.__rpc_mdoc_test_call(
    v_mesa_int, v_exp_replace, 'cliente_acta_nacimiento',
    public.__rpc_mdoc_test_storage_path(v_org, v_exp_replace, 'cliente_acta_nacimiento', 'int.pdf')
  );
  PERFORM public.__rpc_mdoc_test_assert((v_result->>'ok')::boolean = true, 'test 2: mesa_interno');

  -- 3. mesa_externo NO sube en expediente interno
  PERFORM public.__rpc_mdoc_test_assert(
    public.__rpc_mdoc_test_expect_fail(
      v_mesa_ext, v_exp_int, 'cliente_acta_nacimiento',
      public.__rpc_mdoc_test_storage_path(v_org, v_exp_int, 'cliente_acta_nacimiento', 'ext-block.pdf'),
      'no autorizado'
    ),
    'test 3: mesa_externo bloqueado interno'
  );

  -- 4. asesor NO sube acta/sat
  PERFORM public.__rpc_mdoc_test_assert(
    public.__rpc_mdoc_test_expect_fail(
      v_asesor, v_exp_ext, 'cliente_acta_nacimiento',
      public.__rpc_mdoc_test_storage_path(v_org, v_exp_ext, 'cliente_acta_nacimiento', 'asesor.pdf'),
      'rol no autorizado'
    ),
    'test 4a: asesor acta (register_mesa_documento)'
  );
  PERFORM public.__rpc_mdoc_test_assert(
    public.__rpc_mdoc_test_expect_fail(
      v_asesor, v_exp_ext, 'cliente_constancia_sat',
      public.__rpc_mdoc_test_storage_path(v_org, v_exp_ext, 'cliente_constancia_sat', 'asesor.pdf'),
      'rol no autorizado'
    ),
    'test 4b: asesor sat'
  );

  -- 5. mesa NO sube documentos del asesor (NSS)
  PERFORM public.__rpc_mdoc_test_assert(
    public.__rpc_mdoc_test_expect_fail(
      v_mesa_admin, v_exp_int, 'nss', v_path_nss,
      'tipo_documento no permitido para Mesa'
    ),
    'test 5: mesa nss bloqueado'
  );
  PERFORM public.__rpc_mdoc_test_assert(
    public.__rpc_mdoc_test_expect_fail(
      v_mesa_admin, v_exp_int, 'cliente_ine_frente',
      public.__rpc_mdoc_test_storage_path(v_org, v_exp_int, 'cliente_ine_frente'),
      'tipo_documento no permitido para Mesa'
    ),
    'test 5b: mesa INE bloqueado'
  );

  -- 6. submitted_to_mesa=false rechaza (super_admin ve expediente no enviado)
  PERFORM public.__rpc_mdoc_test_assert(
    public.__rpc_mdoc_test_expect_fail(
      v_super, v_exp_not_sent, 'cliente_acta_nacimiento',
      public.__rpc_mdoc_test_storage_path(v_org, v_exp_not_sent, 'cliente_acta_nacimiento'),
      'aún no fue enviado a Mesa'
    ),
    'test 6: no enviado'
  );

  -- 7. storage inexistente rechaza
  PERFORM public.__rpc_mdoc_test_assert(
    public.__rpc_mdoc_test_expect_fail(
      v_mesa_admin, v_exp_ext, 'cliente_acta_nacimiento',
      public.__rpc_mdoc_test_storage_path(v_org, v_exp_ext, 'cliente_acta_nacimiento', 'ghost.pdf'),
      'objeto no encontrado en storage',
      false
    ),
    'test 7: sin objeto storage'
  );

  -- 8. versionado + soft-delete
  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp_replace;
  v_result := public.__rpc_mdoc_test_call(
    v_mesa_int, v_exp_replace, 'cliente_constancia_sat',
    public.__rpc_mdoc_test_storage_path(v_org, v_exp_replace, 'cliente_constancia_sat', 'v1.pdf')
  );
  PERFORM public.__rpc_mdoc_test_assert((v_result->>'version')::int = 1, 'test 8: v1');
  v_result := public.__rpc_mdoc_test_call(
    v_mesa_int, v_exp_replace, 'cliente_constancia_sat',
    public.__rpc_mdoc_test_storage_path(v_org, v_exp_replace, 'cliente_constancia_sat', 'v2.pdf')
  );
  SELECT count(*) INTO v_active_count
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_replace
    AND d.tipo_documento = 'cliente_constancia_sat'
    AND d.deleted_at IS NULL;
  SELECT count(*) INTO v_deleted_count
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_replace
    AND d.tipo_documento = 'cliente_constancia_sat'
    AND d.deleted_at IS NOT NULL;
  PERFORM public.__rpc_mdoc_test_assert(v_active_count = 1, 'test 8: un activo');
  PERFORM public.__rpc_mdoc_test_assert(v_deleted_count >= 1, 'test 8: soft-delete');
  PERFORM public.__rpc_mdoc_test_assert((v_result->>'version')::int = 2, 'test 8: version 2');

  SELECT count(*) INTO v_log_count
  FROM public.action_log al
  WHERE al.action = 'expediente.documento.mesa_register'
    AND al.entity_id = (v_result->>'documento_id')::uuid;
  PERFORM public.__rpc_mdoc_test_assert(v_log_count >= 1, 'test 8: action_log');

  -- 9. Semanas no cuenta como obligatoria
  PERFORM public.__rpc_mdoc_test_assert(
    NOT ('cliente_semanas_cotizadas' = ANY(public.integration_doc_tipos_asesor_envio())),
    'test 9a: semanas fuera envío asesor'
  );
  PERFORM public.__rpc_mdoc_test_assert(
    NOT ('cliente_semanas_cotizadas' = ANY(public.integration_doc_tipos_obligatorios())),
    'test 9b: semanas fuera obligatorios Mesa'
  );
  PERFORM public.__rpc_mdoc_test_assert(
    'cliente_acta_nacimiento' = ANY(public.integration_doc_tipos_obligatorios()),
    'test 9c: acta en obligatorios'
  );
  PERFORM public.__rpc_mdoc_test_assert(
    'cliente_constancia_sat' = ANY(public.integration_doc_tipos_obligatorios()),
    'test 9d: sat en obligatorios'
  );

  RAISE NOTICE 'RPC register_mesa_documento: 9 grupos OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_expect_fail(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_call(UUID, UUID, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_seed_storage(TEXT);
DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_insert_exp(UUID, UUID, UUID, public.origen_mesa, BOOLEAN, CHAR);
DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_storage_path(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_mdoc_test_assert(BOOLEAN, TEXT);
