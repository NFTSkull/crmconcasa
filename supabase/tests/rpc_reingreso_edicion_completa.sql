-- ConCasa CRM — pruebas reingreso edición completa (mig. 150)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_reingreso_edicion_completa.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_rec_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC REC TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_rec_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_rec_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_rec_path(
  p_org UUID, p_exp UUID, p_tipo TEXT, p_suffix TEXT
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/' || p_tipo || '/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_rec_seed_storage(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', p_path, '00000000-0000-4000-8001-000000000001')
  ON CONFLICT (bucket_id, name) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_rec_register(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_rec_seed_storage(p_path);
  PERFORM public.__rpc_rec_auth(p_user);
  SELECT public.register_expediente_documento(
    p_exp, p_tipo, p_path, 'archivo.pdf', 'application/pdf', 2048
  ) INTO v_result;
  PERFORM public.__rpc_rec_reset();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_rec_expect_fail(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT, p_contains TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  PERFORM public.__rpc_rec_seed_storage(p_path);
  PERFORM public.__rpc_rec_auth(p_user);
  BEGIN
    PERFORM public.register_expediente_documento(
      p_exp, p_tipo, p_path, 'archivo.pdf', 'application/pdf', 2048
    );
    PERFORM public.__rpc_rec_reset();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_rec_reset();
    IF position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC REC TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9150-000000000001';
  v_asesor UUID := '00000000-0000-4000-9150-000000000011';
  v_asesor2 UUID := '00000000-0000-4000-9150-000000000012';
  v_exp UUID := '00000000-0000-4000-9150-000000000021';
  v_exp_closed UUID := '00000000-0000-4000-9150-000000000022';
  v_path TEXT;
  v_path2 TEXT;
  v_result JSONB;
  v_active INTEGER;
  v_version INTEGER;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'rec-reingreso-150-org', 'REC Reingreso 150 Org', true)
  ON CONFLICT (slug) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_asesor, 'authenticated', 'authenticated', 'rec150-asesor@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()),
    (v_asesor2, 'authenticated', 'authenticated', 'rec150-asesor2@test.local',
     crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_asesor, v_org, 'rec150-asesor@test.local', 'Asesor REC150', 'asesor', 'interno', true),
    (v_asesor2, v_org, 'rec150-asesor2@test.local', 'Asesor2 REC150', 'asesor', 'interno', true)
  ON CONFLICT (id) DO UPDATE SET active = true, organization_id = EXCLUDED.organization_id;

  -- Manual activo: count>0, etapa 1, submitted
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado,
    reingreso_manual_count, reingreso_manual_at, reingreso_manual_by
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '91500000021', 'Cliente REC150', '5511111121',
    'interno', true, NOW(), 1, 'en_validacion_mesa', 'activo',
    1, NOW(), v_asesor
  ) ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    submitted_to_mesa = true,
    fecha_envio_mesa = NOW(),
    etapa_actual = 1,
    subestado = 'en_validacion_mesa',
    ciclo_estado = 'activo',
    reingreso_manual_count = 1,
    deleted_at = NULL;

  -- Manual cerrado: count>0 pero etapa 3
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre, telefono_cliente,
    origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado,
    reingreso_manual_count
  ) VALUES (
    v_exp_closed, v_org, v_asesor, 'mejoravit', '91500000022', 'Cliente REC150b', '5511111122',
    'interno', true, NOW(), 3, 'en_proceso', 'activo', 2
  ) ON CONFLICT (id) DO UPDATE SET
    etapa_actual = 3,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    reingreso_manual_count = 2,
    submitted_to_mesa = true,
    deleted_at = NULL;

  PERFORM public.__rpc_rec_assert(
    public.es_reingreso_manual_docs_editables(v_exp),
    'manual etapa 1 editable'
  );
  PERFORM public.__rpc_rec_assert(
    public.es_reingreso_asesor_edicion_activa(v_exp),
    'edicion activa alias'
  );
  PERFORM public.__rpc_rec_assert(
    NOT public.es_reingreso_manual_docs_editables(v_exp_closed),
    'manual etapa 3 cerrado'
  );
  PERFORM public.__rpc_rec_assert(
    NOT public.es_reingreso_asesor_edicion_activa(v_exp_closed),
    'edicion inactiva tras avance'
  );

  -- Primer upload INE frente en reingreso activo
  v_path := public.__rpc_rec_path(v_org, v_exp, 'cliente_ine_frente', 'v1.pdf');
  v_result := public.__rpc_rec_register(v_asesor, v_exp, 'cliente_ine_frente', v_path);
  PERFORM public.__rpc_rec_assert(
    (v_result->>'ok')::boolean IS TRUE,
    'INE frente primer upload en reingreso'
  );

  -- Reemplazo versionado
  v_path2 := public.__rpc_rec_path(v_org, v_exp, 'cliente_ine_frente', 'v2.pdf');
  v_result := public.__rpc_rec_register(v_asesor, v_exp, 'cliente_ine_frente', v_path2);
  PERFORM public.__rpc_rec_assert(
    (v_result->>'reemplazo')::boolean IS TRUE,
    'INE frente reemplazo'
  );
  SELECT COUNT(*) INTO v_active
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp
    AND d.tipo_documento = 'cliente_ine_frente'
    AND d.deleted_at IS NULL;
  PERFORM public.__rpc_rec_assert(v_active = 1, 'una sola version activa');
  SELECT d.version INTO v_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp
    AND d.tipo_documento = 'cliente_ine_frente'
    AND d.deleted_at IS NULL;
  PERFORM public.__rpc_rec_assert(v_version = 2, 'version incremental');

  -- Obligatorio faltante bloqueado si reingreso cerrado
  v_path := public.__rpc_rec_path(v_org, v_exp_closed, 'cliente_ine_reverso', 'blocked.pdf');
  PERFORM public.__rpc_rec_assert(
    public.__rpc_rec_expect_fail(
      v_asesor, v_exp_closed, 'cliente_ine_reverso', v_path, 'enviado a Mesa'
    ),
    'INE faltante bloqueado fuera de reingreso activo'
  );

  -- Asesor ajeno
  v_path := public.__rpc_rec_path(v_org, v_exp, 'cliente_estado_cuenta', 'ajeno.pdf');
  PERFORM public.__rpc_rec_assert(
    public.__rpc_rec_expect_fail(
      v_asesor2, v_exp, 'cliente_estado_cuenta', v_path, 'REENTRY_NOT_OWNER'
    ),
    'asesor ajeno bloqueado'
  );

  -- Tipo Mesa-only (no está en asesor_upload) sigue por pre_reingreso y falla
  v_path := public.__rpc_rec_path(v_org, v_exp, 'cliente_constancia_sat', 'mesa.pdf');
  PERFORM public.__rpc_rec_assert(
    public.__rpc_rec_expect_fail(
      v_asesor, v_exp, 'cliente_constancia_sat', v_path, 'no permitido'
    ),
    'tipo Mesa-only no gana permiso asesor'
  );

  -- Etapa no cambia al registrar
  PERFORM public.__rpc_rec_assert(
    (SELECT e.etapa_actual FROM public.expedientes e WHERE e.id = v_exp) = 1,
    'etapa intacta tras registro'
  );

  RAISE NOTICE 'RPC reingreso_edicion_completa: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_rec_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_rec_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_rec_reset();
DROP FUNCTION IF EXISTS public.__rpc_rec_path(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_rec_seed_storage(TEXT);
DROP FUNCTION IF EXISTS public.__rpc_rec_register(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_rec_expect_fail(UUID, UUID, TEXT, TEXT, TEXT);
