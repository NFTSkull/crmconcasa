-- ConCasa CRM — P156: cliente_constancia_curp + validaciones identidad (grants/RLS/SECURITY DEFINER)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--   -f supabase/tests/rpc_cliente_constancia_curp_validaciones.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p156_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P156 CURP VALIDACIONES TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__p156_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p156_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9156-000000000001';
  v_a1 UUID := '00000000-0000-4000-9156-000000000011';
  v_a2 UUID := '00000000-0000-4000-9156-000000000012';
  v_mesa UUID := '00000000-0000-4000-9156-000000000013';
  v_exp UUID := '00000000-0000-4000-9156-000000000021';
  v_exp_ajeno UUID := '00000000-0000-4000-9156-000000000022';
  v_doc UUID := '00000000-0000-4000-9156-000000000031';
  v_result JSONB;
  v_cnt INT;
  v_tipos TEXT[];
  v_path TEXT;
BEGIN
  PERFORM public.__p156_reset_auth();

  -- Harness canónico: org + auth.users + profiles
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p156-curp-validaciones-org', 'P156 CURP Validaciones Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true, slug = EXCLUDED.slug, name = EXCLUDED.name;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_a1, 'authenticated', 'authenticated', 'p156-asesor1@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_a2, 'authenticated', 'authenticated', 'p156-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_mesa, 'authenticated', 'authenticated', 'p156-mesa@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, tipo_mesa, active
  ) VALUES
    (v_a1, v_org, 'p156-asesor1@test.local', 'Asesor P156 Uno', 'asesor', 'interno', NULL, true),
    (v_a2, v_org, 'p156-asesor2@test.local', 'Asesor P156 Dos', 'asesor', 'interno', NULL, true),
    (v_mesa, v_org, 'p156-mesa@test.local', 'Mesa P156', 'mesa_interno', NULL, 'interno', true)
  ON CONFLICT (id) DO UPDATE SET
    active = true,
    organization_id = EXCLUDED.organization_id,
    app_role = EXCLUDED.app_role,
    tipo_mesa = EXCLUDED.tipo_mesa;

  -- Tipo documental en opcionales asesor
  v_tipos := public.integration_doc_tipos_asesor_opcionales();
  PERFORM public.__p156_assert(
    'cliente_constancia_curp' = ANY (v_tipos),
    'cliente_constancia_curp debe estar en opcionales'
  );
  PERFORM public.__p156_assert(
    NOT ('cliente_constancia_curp' = ANY (public.integration_doc_tipos_asesor_envio())),
    'cliente_constancia_curp no debe estar en envio obligatorio'
  );

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_a1, 'mejoravit', '91560000021', 'Fixture Curp Val',
    '5511111121', 'interno', false, 1::smallint, 'pendiente', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    organization_id = EXCLUDED.organization_id,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    updated_at = NOW();

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_ajeno, v_org, v_a2, 'mejoravit', '91560000022', 'Fixture Curp Ajeno',
    '5511111122', 'interno', false, 1::smallint, 'pendiente', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    organization_id = EXCLUDED.organization_id,
    deleted_at = NULL,
    ciclo_estado = 'activo',
    updated_at = NOW();

  -- Documento fixture (versión activa) para FK documento_id
  v_path := v_org::text || '/' || v_exp::text || '/cliente_constancia_curp/v1.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_a1::text)
  ON CONFLICT (bucket_id, name) DO NOTHING;

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version,
    uploaded_by, uploaded_by_role, estatus_revision, deleted_at
  ) VALUES (
    v_doc, v_org, v_exp, 'cliente_constancia_curp', v_path,
    'constancia-synth.pdf', 'application/pdf', 1024, 1,
    v_a1, 'asesor', 'subido', NULL
  )
  ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, version = 1;

  -- Asesor dueño registra
  PERFORM public.__p156_set_auth(v_a1);
  v_result := public.asesor_registrar_validacion_identidad(
    v_exp, 'curp_local', 'VALIDA_LOCALMENTE', 'local',
    jsonb_build_object('status', 'VALIDA_LOCALMENTE', 'fecha_presente', true),
    NULL, NULL, 'fp-test-1', 'local'
  );
  PERFORM public.__p156_assert(COALESCE((v_result->>'ok')::boolean, false), 'registrar ok dueño');

  v_result := public.asesor_list_validaciones_identidad(v_exp);
  PERFORM public.__p156_assert(COALESCE((v_result->>'ok')::boolean, false), 'list ok dueño');
  PERFORM public.__p156_assert(
    jsonb_array_length(v_result->'items') >= 1,
    'list debe devolver al menos 1 vigente'
  );

  -- Una vigente por tipo
  v_result := public.asesor_registrar_validacion_identidad(
    v_exp, 'curp_local', 'FORMATO_INVALIDO', 'local',
    jsonb_build_object('status', 'FORMATO_INVALIDO'),
    NULL, NULL, 'fp-test-2', 'local'
  );
  SELECT count(*) INTO v_cnt
  FROM public.cliente_validaciones_identidad
  WHERE expediente_id = v_exp AND tipo = 'curp_local' AND vigente = true;
  PERFORM public.__p156_assert(v_cnt = 1, 'solo una vigente por tipo');

  SELECT count(*) INTO v_cnt
  FROM public.cliente_validaciones_identidad
  WHERE expediente_id = v_exp AND tipo = 'curp_local' AND vigente = false;
  PERFORM public.__p156_assert(v_cnt >= 1, 'historial preservado');

  -- Resumen sin PII completa
  v_result := public.asesor_registrar_validacion_identidad(
    v_exp, 'curp_constancia', 'CURP_CERTIFICADA_REGISTRO_CIVIL', 'pdf_constancia',
    jsonb_build_object(
      'texto_legible', true,
      'certificada_registro_civil', true,
      'certificacion_otra_autoridad', false,
      'curp_presente', true,
      'nombre_presente', true,
      'campos_con_diferencia', '[]'::jsonb,
      'parser_version', 'p156.2'
    ),
    v_doc, 1, 'fp-doc-1', 'local'
  );
  PERFORM public.__p156_assert(
    NOT ((v_result::text) ILIKE '%pdf_text%'),
    'RPC response no incluye pdf_text'
  );
  PERFORM public.__p156_assert(
    NOT EXISTS (
      SELECT 1 FROM public.cliente_validaciones_identidad
      WHERE expediente_id = v_exp AND tipo = 'curp_constancia' AND vigente = true
        AND (
          resultado_resumido ? 'curp'
          OR resultado_resumido ? 'nombre_completo'
          OR resultado_resumido ? 'primer_apellido'
          OR resultado_resumido ? 'fecha_nacimiento'
          OR resultado_resumido ? 'numero_acta'
          OR resultado_resumido ? 'municipio_registro'
        )
    ),
    'resultado_resumido no debe guardar PII completa'
  );

  -- Asesor ajeno bloqueado
  PERFORM public.__p156_set_auth(v_a2);
  BEGIN
    PERFORM public.asesor_registrar_validacion_identidad(
      v_exp, 'curp_local', 'VALIDA_LOCALMENTE', 'local', '{}'::jsonb
    );
    PERFORM public.__p156_assert(false, 'asesor ajeno no debe registrar');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    NULL;
  END;

  BEGIN
    PERFORM public.asesor_list_validaciones_identidad(v_exp);
    PERFORM public.__p156_assert(false, 'asesor ajeno no debe listar');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    NULL;
  END;

  -- Mesa puede listar
  PERFORM public.__p156_set_auth(v_mesa);
  v_result := public.asesor_list_validaciones_identidad(v_exp);
  PERFORM public.__p156_assert(COALESCE((v_result->>'ok')::boolean, false), 'mesa list ok');

  -- Mesa no registra
  BEGIN
    PERFORM public.asesor_registrar_validacion_identidad(
      v_exp, 'rfc_estimado', 'RFC_ESTIMADO', 'local', '{}'::jsonb
    );
    PERFORM public.__p156_assert(false, 'mesa no debe registrar');
  EXCEPTION WHEN insufficient_privilege OR SQLSTATE '42501' THEN
    NULL;
  END;

  -- Invalidación selectiva (solo rfc_*)
  PERFORM public.__p156_set_auth(v_a1);
  PERFORM public.asesor_registrar_validacion_identidad(
    v_exp, 'rfc_estimado', 'RFC_ESTIMADO', 'local',
    jsonb_build_object('status', 'RFC_ESTIMADO', 'tiene_estimado', true),
    NULL, NULL, 'fp-rfc', 'local'
  );
  PERFORM public.asesor_registrar_validacion_identidad(
    v_exp, 'rfc_validacion_sat', 'RFC_VALIDACION_SAT_PENDIENTE', 'local',
    jsonb_build_object('status', 'RFC_VALIDACION_SAT_PENDIENTE'),
    NULL, NULL, 'fp-sat', 'local'
  );
  v_result := public.asesor_invalidar_validaciones_identidad(
    v_exp, 'rfc_cambio', ARRAY['rfc_estimado', 'rfc_validacion_sat']::TEXT[]
  );
  PERFORM public.__p156_assert(COALESCE((v_result->>'ok')::boolean, false), 'invalidar selectivo ok');
  SELECT count(*) INTO v_cnt
  FROM public.cliente_validaciones_identidad
  WHERE expediente_id = v_exp AND tipo LIKE 'rfc_%' AND vigente = true;
  PERFORM public.__p156_assert(v_cnt = 0, 'rfc vigentes invalidados');
  SELECT count(*) INTO v_cnt
  FROM public.cliente_validaciones_identidad
  WHERE expediente_id = v_exp AND tipo = 'curp_constancia' AND vigente = true;
  PERFORM public.__p156_assert(v_cnt = 1, 'constancia sigue vigente tras invalidacion selectiva');

  -- Invalidar todas
  v_result := public.asesor_invalidar_validaciones_identidad(v_exp, 'datos_cambiaron', NULL);
  PERFORM public.__p156_assert(COALESCE((v_result->>'ok')::boolean, false), 'invalidar todas ok');
  SELECT count(*) INTO v_cnt
  FROM public.cliente_validaciones_identidad
  WHERE expediente_id = v_exp AND vigente = true;
  PERFORM public.__p156_assert(v_cnt = 0, 'ninguna vigente tras invalidar todas');

  PERFORM public.__p156_assert(
    EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'cliente_validaciones_identidad'
        AND policyname = 'cliente_validaciones_identidad_select'
    ),
    'policy SELECT existe'
  );

  PERFORM public.__p156_reset_auth();
  RAISE NOTICE 'P156 CURP VALIDACIONES OK';
END $$;

DROP FUNCTION IF EXISTS public.__p156_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__p156_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p156_reset_auth();
