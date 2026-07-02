-- ConCasa CRM — pruebas P3J.6 correcciones asesor post-rechazo Mesa
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_correcciones_asesor_post_mesa.sql

\set ON_ERROR_STOP on

DROP FUNCTION IF EXISTS public.__rpc_acpm_test_insert_exp(UUID, UUID, UUID, public.origen_mesa, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_insert_exp(UUID, UUID, UUID, public.origen_mesa, BOOLEAN, CHAR);

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC ACPM TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_storage_path(
  p_org UUID, p_exp UUID, p_tipo TEXT, p_suffix TEXT DEFAULT 'doc.pdf'
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/' || p_tipo || '/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_insert_exp(
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
    p_id, p_org, p_asesor, 'mejoravit', v_nss, 'Fixture ACPM',
    '5511111111', p_origen,
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    1,
    CASE WHEN p_submitted THEN 'en_validacion_mesa'::public.operativo_subestado ELSE 'pendiente'::public.operativo_subestado END,
    'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    origen_mesa = EXCLUDED.origen_mesa,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    fecha_envio_mesa = EXCLUDED.fecha_envio_mesa,
    subestado = EXCLUDED.subestado,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_seed_storage(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', p_path, '00000000-0000-4000-8003-000000000001')
  ON CONFLICT (bucket_id, name) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_insert_doc(
  p_id UUID, p_org UUID, p_exp UUID, p_tipo TEXT,
  p_estatus public.estatus_revision DEFAULT 'rechazado',
  p_version INTEGER DEFAULT 1,
  p_comentario TEXT DEFAULT 'Rechazado por Mesa (fixture)'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento,
    storage_path, nombre_original, mime_type, size_bytes,
    version, estatus_revision, comentario_mesa,
    uploaded_by, uploaded_by_role
  ) VALUES (
    p_id, p_org, p_exp, p_tipo,
    public.__rpc_acpm_test_storage_path(p_org, p_exp, p_tipo, 'prev.pdf'),
    'prev.pdf', 'application/pdf', 512,
    p_version, p_estatus, p_comentario,
    '00000000-0000-4000-8001-000000000001', 'asesor'
  )
  ON CONFLICT (id) DO UPDATE SET
    expediente_id = EXCLUDED.expediente_id,
    tipo_documento = EXCLUDED.tipo_documento,
    version = EXCLUDED.version,
    estatus_revision = EXCLUDED.estatus_revision,
    comentario_mesa = EXCLUDED.comentario_mesa,
    deleted_at = NULL,
    updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_insert_cliente(
  p_exp UUID, p_org UUID, p_estado public.cliente_datos_estado DEFAULT 'rechazado',
  p_comentario TEXT DEFAULT 'Datos rechazados (fixture)',
  p_telefono TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_tel TEXT;
BEGIN
  v_tel := COALESCE(p_telefono, '55' || right(replace(p_exp::text, '-', ''), 8));
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, comentario_rechazo,
    telefono_normalizado, referencias
  ) VALUES (
    p_exp, p_org,
    jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Fixture ACPM', 'celular', v_tel),
    p_estado, p_comentario,
    v_tel, '[]'::jsonb
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    estado = EXCLUDED.estado,
    comentario_rechazo = EXCLUDED.comentario_rechazo,
    datos = EXCLUDED.datos,
    telefono_normalizado = EXCLUDED.telefono_normalizado,
    referencias = EXCLUDED.referencias,
    validated_at = NULL,
    validated_by = NULL,
    rejected_at = CASE WHEN EXCLUDED.estado = 'rechazado' THEN NOW() ELSE NULL END,
    rejected_by = CASE
      WHEN EXCLUDED.estado = 'rechazado'
        THEN '00000000-0000-4000-8003-000000000001'::uuid
      ELSE NULL
    END,
    updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_call_doc(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT, p_seed BOOLEAN DEFAULT true
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_seed THEN
    PERFORM public.__rpc_acpm_test_seed_storage(p_path);
  END IF;
  PERFORM public.__rpc_acpm_test_set_auth(p_user);
  SELECT public.register_expediente_documento_correccion(
    p_exp, p_tipo, p_path, 'correccion.pdf', 'application/pdf', 2048
  ) INTO v_result;
  PERFORM public.__rpc_acpm_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_expect_doc_fail(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT,
  p_contains TEXT DEFAULT NULL, p_seed BOOLEAN DEFAULT true
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  IF p_seed THEN
    PERFORM public.__rpc_acpm_test_seed_storage(p_path);
  END IF;
  PERFORM public.__rpc_acpm_test_set_auth(p_user);
  BEGIN
    PERFORM public.register_expediente_documento_correccion(
      p_exp, p_tipo, p_path, 'correccion.pdf', 'application/pdf', 2048
    );
    PERFORM public.__rpc_acpm_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_acpm_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC ACPM TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_call_datos(p_user UUID, p_exp UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_result JSONB;
  v_tel TEXT;
BEGIN
  v_tel := '55' || right(replace(p_exp::text, '-', ''), 8);
  PERFORM public.__rpc_acpm_test_set_auth(p_user);
  SELECT public.save_cliente_datos_correccion(
    p_exp,
    'XAXX010101000',
    v_tel,
    '[]'::jsonb,
    NULL,
    jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Corregido ACPM', 'celular', v_tel)
  ) INTO v_result;
  PERFORM public.__rpc_acpm_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_acpm_test_expect_datos_fail(
  p_user UUID, p_exp UUID, p_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__rpc_acpm_test_set_auth(p_user);
  BEGIN
    PERFORM public.save_cliente_datos_correccion(
      p_exp, 'XAXX010101000', '5522222222', '[]'::jsonb, NULL,
      jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Fail')
    );
    PERFORM public.__rpc_acpm_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_acpm_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC ACPM TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000002';

  v_exp_ok UUID := '00000000-0000-4000-9033-000000000010';
  v_exp_valid UUID := '00000000-0000-4000-9033-000000000020';
  v_exp_subido UUID := '00000000-0000-4000-9033-000000000030';
  v_exp_other UUID := '00000000-0000-4000-9033-000000000040';
  v_exp_semanas UUID := '00000000-0000-4000-9033-000000000050';
  v_exp_datos UUID := '00000000-0000-4000-9033-000000000060';
  v_exp_datos_val UUID := '00000000-0000-4000-9033-000000000070';
  v_exp_datos_comp UUID := '00000000-0000-4000-9033-000000000080';

  v_doc_rech UUID := '00000000-0000-4000-9034-000000000010';
  v_doc_val UUID := '00000000-0000-4000-9034-000000000020';
  v_doc_sub UUID := '00000000-0000-4000-9034-000000000030';
  v_doc_other UUID := '00000000-0000-4000-9034-000000000040';
  v_doc_sem_rech UUID := '00000000-0000-4000-9034-000000000050';
  v_doc_sem_sub UUID := '00000000-0000-4000-9034-000000000060';

  v_path_ine TEXT;
  v_path_ine_v2 TEXT;
  v_path_sem TEXT;
  v_path_no_storage TEXT;
  v_path_acta TEXT;
  v_path_sat TEXT;

  v_result JSONB;
  v_prev_deleted TIMESTAMPTZ;
  v_active_count INTEGER;
  v_new_row public.expediente_documentos%ROWTYPE;
  v_log_count INTEGER;
  v_cd public.cliente_datos%ROWTYPE;
BEGIN
  PERFORM public.__rpc_acpm_test_insert_exp(v_exp_ok, v_org, v_asesor, 'interno'::public.origen_mesa, true, '90331000001');
  PERFORM public.__rpc_acpm_test_insert_exp(v_exp_valid, v_org, v_asesor, 'interno'::public.origen_mesa, true, '90331000002');
  PERFORM public.__rpc_acpm_test_insert_exp(v_exp_subido, v_org, v_asesor, 'interno'::public.origen_mesa, true, '90331000003');
  PERFORM public.__rpc_acpm_test_insert_exp(v_exp_other, v_org, v_asesor2, 'externo'::public.origen_mesa, true, '90331000004');
  PERFORM public.__rpc_acpm_test_insert_exp(v_exp_semanas, v_org, v_asesor, 'interno'::public.origen_mesa, true, '90331000005');
  PERFORM public.__rpc_acpm_test_insert_exp(v_exp_datos, v_org, v_asesor, 'interno'::public.origen_mesa, true, '90331000006');
  PERFORM public.__rpc_acpm_test_insert_exp(v_exp_datos_val, v_org, v_asesor, 'interno'::public.origen_mesa, true, '90331000007');
  PERFORM public.__rpc_acpm_test_insert_exp(v_exp_datos_comp, v_org, v_asesor, 'interno'::public.origen_mesa, true, '90331000008');

  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (
    v_exp_ok, v_exp_valid, v_exp_subido, v_exp_other, v_exp_semanas
  );

  PERFORM public.__rpc_acpm_test_insert_doc(v_doc_rech, v_org, v_exp_ok, 'cliente_ine_frente', 'rechazado', 1);
  PERFORM public.__rpc_acpm_test_insert_doc(v_doc_val, v_org, v_exp_valid, 'cliente_ine_frente', 'validado', 1);
  PERFORM public.__rpc_acpm_test_insert_doc(v_doc_sub, v_org, v_exp_subido, 'cliente_comprobante_domicilio', 'subido', 1);
  PERFORM public.__rpc_acpm_test_insert_doc(v_doc_other, v_org, v_exp_other, 'cliente_ine_frente', 'rechazado', 1);
  PERFORM public.__rpc_acpm_test_insert_doc(v_doc_sem_rech, v_org, v_exp_semanas, 'cliente_semanas_cotizadas', 'rechazado', 1);
  PERFORM public.__rpc_acpm_test_insert_doc(v_doc_sem_sub, v_org, v_exp_semanas, 'cliente_ine_frente', 'subido', 1);

  v_path_ine := public.__rpc_acpm_test_storage_path(v_org, v_exp_ok, 'cliente_ine_frente', 'corr-v2.pdf');
  v_path_ine_v2 := public.__rpc_acpm_test_storage_path(v_org, v_exp_ok, 'cliente_ine_frente', 'corr-v3.pdf');
  v_path_sem := public.__rpc_acpm_test_storage_path(v_org, v_exp_semanas, 'cliente_semanas_cotizadas', 'sem-corr.pdf');
  v_path_no_storage := public.__rpc_acpm_test_storage_path(v_org, v_exp_ok, 'cliente_ine_frente', 'missing.pdf');
  v_path_acta := public.__rpc_acpm_test_storage_path(v_org, v_exp_ok, 'cliente_acta_nacimiento', 'acta.pdf');
  v_path_sat := public.__rpc_acpm_test_storage_path(v_org, v_exp_ok, 'cliente_constancia_sat', 'sat.pdf');

  -- 1. asesor dueño resube documento rechazado con submitted_to_mesa=true
  v_result := public.__rpc_acpm_test_call_doc(v_asesor, v_exp_ok, 'cliente_ine_frente', v_path_ine);
  PERFORM public.__rpc_acpm_test_assert((v_result->>'ok')::boolean = true, 'test 1: ok');
  PERFORM public.__rpc_acpm_test_assert(v_result->>'estatus_revision' = 'resubido', 'test 1: resubido');

  -- 2. asesor NO resube documento validado
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_doc_fail(
      v_asesor, v_exp_valid, 'cliente_ine_frente',
      public.__rpc_acpm_test_storage_path(v_org, v_exp_valid, 'cliente_ine_frente', 'fail.pdf'),
      'solo se puede corregir un documento rechazado'
    ),
    'test 2: validado bloqueado'
  );

  -- 3. asesor NO resube documento subido/no rechazado
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_doc_fail(
      v_asesor, v_exp_subido, 'cliente_comprobante_domicilio',
      public.__rpc_acpm_test_storage_path(v_org, v_exp_subido, 'cliente_comprobante_domicilio', 'fail.pdf'),
      'solo se puede corregir un documento rechazado'
    ),
    'test 3: subido bloqueado'
  );

  -- 4. asesor NO resube documento de otro asesor
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_doc_fail(
      v_asesor, v_exp_other, 'cliente_ine_frente',
      public.__rpc_acpm_test_storage_path(v_org, v_exp_other, 'cliente_ine_frente', 'fail.pdf'),
      'solo el asesor dueño'
    ),
    'test 4: otro asesor bloqueado'
  );

  -- 5. asesor NO sube acta/constancia SAT
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_doc_fail(
      v_asesor, v_exp_ok, 'cliente_acta_nacimiento', v_path_acta,
      'tipo_documento no permitido'
    ),
    'test 5a: acta bloqueada'
  );
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_doc_fail(
      v_asesor, v_exp_ok, 'cliente_constancia_sat', v_path_sat,
      'tipo_documento no permitido'
    ),
    'test 5b: sat bloqueada'
  );

  -- 6. semanas solo si fue rechazada (rechazada OK; subida bloqueada)
  v_result := public.__rpc_acpm_test_call_doc(
    v_asesor, v_exp_semanas, 'cliente_semanas_cotizadas', v_path_sem
  );
  PERFORM public.__rpc_acpm_test_assert(v_result->>'tipo_documento' = 'cliente_semanas_cotizadas', 'test 6a: semanas rechazada ok');
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_doc_fail(
      v_asesor, v_exp_semanas, 'cliente_ine_frente',
      public.__rpc_acpm_test_storage_path(v_org, v_exp_semanas, 'cliente_ine_frente', 'fail.pdf'),
      'solo se puede corregir un documento rechazado'
    ),
    'test 6b: semanas/subido bloqueado'
  );

  -- 7. storage inexistente rechaza
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_doc_fail(
      v_asesor, v_exp_ok, 'cliente_ine_frente', v_path_no_storage,
      'objeto no encontrado en storage', false
    ),
    'test 7: storage faltante'
  );

  -- 8. versionado y soft-delete (segunda corrección en v_exp_ok ya tiene resubido activo — usar nuevo rechazo)
  UPDATE public.expediente_documentos
  SET estatus_revision = 'rechazado', comentario_mesa = 'Segundo rechazo', deleted_at = NULL
  WHERE expediente_id = v_exp_ok AND tipo_documento = 'cliente_ine_frente' AND deleted_at IS NULL;

  SELECT deleted_at INTO v_prev_deleted FROM public.expediente_documentos WHERE id = v_doc_rech;
  PERFORM public.__rpc_acpm_test_assert(v_prev_deleted IS NOT NULL, 'test 8: doc anterior soft-deleted');

  v_result := public.__rpc_acpm_test_call_doc(v_asesor, v_exp_ok, 'cliente_ine_frente', v_path_ine_v2);
  PERFORM public.__rpc_acpm_test_assert((v_result->>'version')::integer >= 2, 'test 8: version incrementada');

  SELECT COUNT(*) INTO v_active_count
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp_ok AND tipo_documento = 'cliente_ine_frente' AND deleted_at IS NULL;
  PERFORM public.__rpc_acpm_test_assert(v_active_count = 1, 'test 8: un activo');

  SELECT * INTO v_new_row
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp_ok AND tipo_documento = 'cliente_ine_frente' AND deleted_at IS NULL;
  PERFORM public.__rpc_acpm_test_assert(v_new_row.estatus_revision = 'resubido', 'test 8: activo resubido');
  PERFORM public.__rpc_acpm_test_assert(v_new_row.comentario_mesa IS NULL, 'test 8: sin comentario_mesa');

  -- 9. action_log escrito
  SELECT COUNT(*) INTO v_log_count
  FROM public.action_log
  WHERE action = 'expediente.documento.asesor_correccion'
    AND entity_id = v_new_row.id;
  PERFORM public.__rpc_acpm_test_assert(v_log_count >= 1, 'test 9: action_log documento');

  -- 10. asesor dueño corrige cliente_datos rechazado
  PERFORM public.__rpc_acpm_test_insert_cliente(v_exp_datos, v_org, 'rechazado', 'RFC incorrecto');
  v_result := public.__rpc_acpm_test_call_datos(v_asesor, v_exp_datos);
  PERFORM public.__rpc_acpm_test_assert((v_result->>'estado') = 'completo', 'test 10: estado completo');

  -- 11. NO corrige si validado o completo
  PERFORM public.__rpc_acpm_test_insert_cliente(v_exp_datos_val, v_org, 'validado', NULL);
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_datos_fail(v_asesor, v_exp_datos_val, 'estado rechazado'),
    'test 11a: validado bloqueado'
  );
  PERFORM public.__rpc_acpm_test_insert_cliente(v_exp_datos_comp, v_org, 'completo', NULL);
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_datos_fail(v_asesor, v_exp_datos_comp, 'estado rechazado'),
    'test 11b: completo bloqueado'
  );

  -- 12. NO corrige datos de otro expediente (asesor1 intenta exp de asesor2)
  PERFORM public.__rpc_acpm_test_insert_cliente(v_exp_other, v_org, 'rechazado', 'Otro asesor');
  PERFORM public.__rpc_acpm_test_assert(
    public.__rpc_acpm_test_expect_datos_fail(v_asesor, v_exp_other, 'solo el asesor dueño'),
    'test 12: otro expediente bloqueado'
  );

  -- 13. corrección limpia comentario_rechazo y deja completo
  SELECT * INTO v_cd FROM public.cliente_datos WHERE expediente_id = v_exp_datos;
  PERFORM public.__rpc_acpm_test_assert(v_cd.estado = 'completo', 'test 13: estado completo');
  PERFORM public.__rpc_acpm_test_assert(v_cd.comentario_rechazo IS NULL, 'test 13: sin comentario');
  PERFORM public.__rpc_acpm_test_assert(v_cd.rejected_at IS NULL, 'test 13: sin rejected_at');
  PERFORM public.__rpc_acpm_test_assert(v_cd.rejected_by IS NULL, 'test 13: sin rejected_by');

  SELECT COUNT(*) INTO v_log_count
  FROM public.action_log
  WHERE action = 'cliente_datos.correccion_post_mesa'
    AND entity_id = v_exp_datos;
  PERFORM public.__rpc_acpm_test_assert(v_log_count >= 1, 'test 13: action_log datos');

  DELETE FROM public.cliente_datos
  WHERE expediente_id IN (
    v_exp_ok, v_exp_valid, v_exp_subido, v_exp_other, v_exp_semanas,
    v_exp_datos, v_exp_datos_val, v_exp_datos_comp
  );
  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (
    v_exp_ok, v_exp_valid, v_exp_subido, v_exp_other, v_exp_semanas
  );
  DELETE FROM public.expedientes
  WHERE id IN (
    v_exp_ok, v_exp_valid, v_exp_subido, v_exp_other, v_exp_semanas,
    v_exp_datos, v_exp_datos_val, v_exp_datos_comp
  );

  RAISE NOTICE 'RPC ACPM TESTS: ALL PASSED';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_acpm_test_expect_datos_fail(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_call_datos(UUID, UUID);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_expect_doc_fail(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_call_doc(UUID, UUID, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_insert_cliente(UUID, UUID, public.cliente_datos_estado, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_insert_cliente(UUID, UUID, public.cliente_datos_estado, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_insert_doc(UUID, UUID, UUID, TEXT, public.estatus_revision, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_seed_storage(TEXT);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_insert_exp(UUID, UUID, UUID, public.origen_mesa, BOOLEAN, CHAR);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_storage_path(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_acpm_test_assert(BOOLEAN, TEXT);
