-- ConCasa CRM — pruebas P3O.1 RPC register_expediente_documento_retencion
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_register_expediente_documento_retencion.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_regret_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'RPC REGRET TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regret_test_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regret_test_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regret_test_storage_path(
  p_org UUID, p_exp UUID, p_tipo TEXT, p_suffix TEXT DEFAULT 'doc.pdf'
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/' || p_tipo || '/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_regret_test_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11),
  p_etapa SMALLINT DEFAULT 8,
  p_submitted BOOLEAN DEFAULT true,
  p_subestado public.operativo_subestado DEFAULT 'en_proceso',
  p_ciclo public.expediente_ciclo_estado DEFAULT 'activo'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture RegRet',
    '5511111111', 'interno', p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, p_subestado, p_ciclo
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    ciclo_estado = EXCLUDED.ciclo_estado,
    deleted_at = NULL,
    updated_at = NOW();
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regret_test_seed_storage(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', p_path, '00000000-0000-4000-8001-000000000001')
  ON CONFLICT (bucket_id, name) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regret_test_call(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT,
  p_name TEXT DEFAULT 'archivo.pdf', p_mime TEXT DEFAULT 'application/pdf', p_size BIGINT DEFAULT 1024
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_result JSONB;
BEGIN
  PERFORM public.__rpc_regret_test_seed_storage(p_path);
  PERFORM public.__rpc_regret_test_set_auth(p_user);
  SELECT public.register_expediente_documento_retencion(
    p_exp, p_tipo, p_path, p_name, p_mime, p_size
  ) INTO v_result;
  PERFORM public.__rpc_regret_test_reset_auth();
  RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regret_test_expect_fail(
  p_user UUID, p_exp UUID, p_tipo TEXT, p_path TEXT,
  p_contains TEXT DEFAULT NULL,
  p_seed_storage BOOLEAN DEFAULT false
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE v_err TEXT;
BEGIN
  IF p_seed_storage THEN
    PERFORM public.__rpc_regret_test_seed_storage(p_path);
  END IF;
  PERFORM public.__rpc_regret_test_set_auth(p_user);
  BEGIN
    PERFORM public.register_expediente_documento_retencion(
      p_exp, p_tipo, p_path, 'archivo.pdf', 'application/pdf', 1024
    );
    PERFORM public.__rpc_regret_test_reset_auth();
    RETURN false;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__rpc_regret_test_reset_auth();
    IF p_contains IS NOT NULL AND position(p_contains IN v_err) = 0 THEN
      RAISE EXCEPTION 'RPC REGRET TEST FAIL: esperaba "%", obtuvo: %', p_contains, v_err;
    END IF;
    RETURN true;
  END;
END; $$;

CREATE OR REPLACE FUNCTION public.__rpc_regret_test_insert_cliente(
  p_exp UUID, p_org UUID, p_estado public.cliente_datos_estado DEFAULT 'validado'
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (p_exp, p_org, jsonb_build_object('rfc', 'XAXX010101000'), p_estado)
  ON CONFLICT (expediente_id) DO UPDATE SET estado = EXCLUDED.estado, updated_at = NOW();
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';

  v_exp_ok UUID := '00000000-0000-4000-9035-000000000010';
  v_exp_owner UUID := '00000000-0000-4000-9035-000000000020';
  v_exp_etapa7 UUID := '00000000-0000-4000-9035-000000000030';
  v_exp_pre UUID := '00000000-0000-4000-9035-000000000040';
  v_exp_flow UUID := '00000000-0000-4000-9035-000000000050';
  v_exp_int UUID := '00000000-0000-4000-9035-000000000060';

  v_path_acuse TEXT;
  v_result JSONB;
  v_tipo TEXT;
  v_doc_id UUID;
  v_storage_ok BOOLEAN;
BEGIN
  PERFORM public.__rpc_regret_test_insert_exp(v_exp_ok, v_org, v_a1, '90351000010'::char(11));
  PERFORM public.__rpc_regret_test_insert_exp(v_exp_owner, v_org, v_a2, '90352000020'::char(11));
  PERFORM public.__rpc_regret_test_insert_exp(v_exp_etapa7, v_org, v_a1, '90353000030'::char(11), 7::smallint);
  PERFORM public.__rpc_regret_test_insert_exp(v_exp_pre, v_org, v_a1, '90354000040'::char(11), 1::smallint, false, 'pendiente'::public.operativo_subestado);
  PERFORM public.__rpc_regret_test_insert_exp(v_exp_flow, v_org, v_a1, '90355000050'::char(11));
  PERFORM public.__rpc_regret_test_insert_exp(v_exp_int, v_org, v_a1, '90356000060'::char(11), 1::smallint, false, 'pendiente'::public.operativo_subestado);

  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (v_exp_ok, v_exp_owner, v_exp_etapa7, v_exp_pre, v_exp_flow, v_exp_int);

  v_path_acuse := public.__rpc_regret_test_storage_path(
    v_org, v_exp_ok, 'retencion_acuse_con_sello', 'acuse.pdf'
  );

  -- 1. asesor dueño registra retencion_* en etapa 8
  v_result := public.__rpc_regret_test_call(
    v_a1, v_exp_ok, 'retencion_acuse_con_sello', v_path_acuse
  );
  PERFORM public.__rpc_regret_test_assert((v_result->>'ok')::boolean = true, 'test 1: ok');
  PERFORM public.__rpc_regret_test_assert(
    v_result->>'estatus_revision' = 'subido', 'test 1: estatus subido'
  );

  -- 2. tipo integración bloqueado en RPC retención
  PERFORM public.__rpc_regret_test_assert(
    public.__rpc_regret_test_expect_fail(
      v_a1, v_exp_ok, 'nss',
      public.__rpc_regret_test_storage_path(v_org, v_exp_ok, 'nss'),
      'no permitido para retención'
    ),
    'test 2: nss bloqueado'
  );

  -- 3. retención bloqueada en register_expediente_documento (integración)
  PERFORM public.__rpc_regret_test_seed_storage(
    public.__rpc_regret_test_storage_path(v_org, v_exp_int, 'retencion_acuse_con_sello', 'bad.pdf')
  );
  PERFORM public.__rpc_regret_test_set_auth(v_a1);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp_int, 'retencion_acuse_con_sello',
      public.__rpc_regret_test_storage_path(v_org, v_exp_int, 'retencion_acuse_con_sello', 'bad.pdf'),
      'bad.pdf', 'application/pdf', 1024
    );
    PERFORM public.__rpc_regret_test_reset_auth();
    RAISE EXCEPTION 'RPC REGRET TEST FAIL: test 3 debía rechazar retención en register integración';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_regret_test_reset_auth();
    PERFORM public.__rpc_regret_test_assert(
      position('no permitido para upload asesor' IN SQLERRM) > 0,
      'test 3: retención bloqueada en register integración'
    );
  END;

  -- 4. integración sigue funcionando (cliente_ine_frente pre-Mesa)
  PERFORM public.__rpc_regret_test_seed_storage(
    public.__rpc_regret_test_storage_path(v_org, v_exp_int, 'cliente_ine_frente', 'int2.pdf')
  );
  PERFORM public.__rpc_regret_test_set_auth(v_a1);
  SELECT public.register_expediente_documento(
    v_exp_int, 'cliente_ine_frente',
    public.__rpc_regret_test_storage_path(v_org, v_exp_int, 'cliente_ine_frente', 'int2.pdf'),
    'ine.pdf', 'application/pdf', 1024
  ) INTO v_result;
  PERFORM public.__rpc_regret_test_reset_auth();
  PERFORM public.__rpc_regret_test_assert((v_result->>'ok')::boolean = true, 'test 4: integración ine frente ok');

  -- 4b. nss bloqueado en register integración
  PERFORM public.__rpc_regret_test_seed_storage(
    public.__rpc_regret_test_storage_path(v_org, v_exp_int, 'nss', 'nss-block.pdf')
  );
  PERFORM public.__rpc_regret_test_set_auth(v_a1);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp_int, 'nss',
      public.__rpc_regret_test_storage_path(v_org, v_exp_int, 'nss', 'nss-block.pdf'),
      'nss.pdf', 'application/pdf', 1024
    );
    PERFORM public.__rpc_regret_test_reset_auth();
    RAISE EXCEPTION 'RPC REGRET TEST FAIL: test 4b debía rechazar nss en integración';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_regret_test_reset_auth();
    PERFORM public.__rpc_regret_test_assert(
      position('no permitido para upload asesor' IN SQLERRM) > 0,
      'test 4b: nss bloqueado en integración'
    );
  END;

  -- 5. asesor no dueño bloqueado
  PERFORM public.__rpc_regret_test_assert(
    public.__rpc_regret_test_expect_fail(
      v_a1, v_exp_owner, 'retencion_acuse_con_sello',
      public.__rpc_regret_test_storage_path(v_org, v_exp_owner, 'retencion_acuse_con_sello'),
      'solo el asesor dueño'
    ),
    'test 5: asesor ajeno'
  );

  -- 6. etapa distinta bloqueada
  PERFORM public.__rpc_regret_test_assert(
    public.__rpc_regret_test_expect_fail(
      v_a1, v_exp_etapa7, 'retencion_acuse_con_sello',
      public.__rpc_regret_test_storage_path(v_org, v_exp_etapa7, 'retencion_acuse_con_sello'),
      'debe estar en etapa 8'
    ),
    'test 6: etapa 7 bloqueada'
  );

  -- 7. pre-Mesa bloqueado
  PERFORM public.__rpc_regret_test_assert(
    public.__rpc_regret_test_expect_fail(
      v_a1, v_exp_pre, 'retencion_acuse_con_sello',
      public.__rpc_regret_test_storage_path(v_org, v_exp_pre, 'retencion_acuse_con_sello'),
      'aún no fue enviado a Mesa'
    ),
    'test 7: pre-Mesa bloqueado'
  );

  -- 8. mesa/editor bloqueados
  PERFORM public.__rpc_regret_test_assert(
    public.__rpc_regret_test_expect_fail(v_mesa, v_exp_ok, 'retencion_acuse_con_sello', v_path_acuse, 'rol no autorizado'),
    'test 8: mesa bloqueada'
  );
  PERFORM public.__rpc_regret_test_assert(
    public.__rpc_regret_test_expect_fail(v_editor, v_exp_ok, 'retencion_acuse_con_sello', v_path_acuse, 'rol no autorizado'),
    'test 8b: editor bloqueado'
  );

  -- 9. resubida tras rechazo → resubido
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp_ok, 'retencion_aviso_retencion',
    public.__rpc_regret_test_storage_path(v_org, v_exp_ok, 'retencion_aviso_retencion', 'old.pdf'),
    'old.pdf', 'application/pdf', 100, 1, 'rechazado', v_a1, 'asesor'
  );
  v_result := public.__rpc_regret_test_call(
    v_a1, v_exp_ok, 'retencion_aviso_retencion',
    public.__rpc_regret_test_storage_path(v_org, v_exp_ok, 'retencion_aviso_retencion', 'new.pdf')
  );
  PERFORM public.__rpc_regret_test_assert(
    v_result->>'estatus_revision' = 'resubido', 'test 9: resubido tras rechazo'
  );

  -- 10. validado bloquea reemplazo
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp_ok, 'retencion_ine_frente',
    public.__rpc_regret_test_storage_path(v_org, v_exp_ok, 'retencion_ine_frente', 'val.pdf'),
    'val.pdf', 'application/pdf', 100, 1, 'validado', v_a1, 'asesor'
  );
  PERFORM public.__rpc_regret_test_assert(
    public.__rpc_regret_test_expect_fail(
      v_a1, v_exp_ok, 'retencion_ine_frente',
      public.__rpc_regret_test_storage_path(v_org, v_exp_ok, 'retencion_ine_frente', 'new.pdf'),
      'documento validado',
      true
    ),
    'test 10: validado bloquea reemplazo'
  );

  -- 11. storage helper permite path retención etapa 8
  PERFORM public.__rpc_regret_test_set_auth(v_a1);
  SELECT public.expediente_documento_storage_asesor_retencion_upload_allowed(
    public.__rpc_regret_test_storage_path(v_org, v_exp_flow, 'retencion_ine_reverso', 'stor.pdf')
  ) INTO v_storage_ok;
  PERFORM public.__rpc_regret_test_reset_auth();
  PERFORM public.__rpc_regret_test_assert(v_storage_ok = true, 'test 11: storage helper etapa 8');

  -- 12. registrar los 4 docs con_sello + enviar_retencion_mesa
  DELETE FROM public.expediente_documentos WHERE expediente_id = v_exp_flow;
  DELETE FROM public.retencion_envios WHERE expediente_id = v_exp_flow;
  DELETE FROM public.retencion_opciones WHERE expediente_id = v_exp_flow;

  FOREACH v_tipo IN ARRAY public.retencion_doc_tipos_requeridos('con_sello'::public.retencion_opcion)
  LOOP
    PERFORM public.__rpc_regret_test_call(
      v_a1, v_exp_flow, v_tipo,
      public.__rpc_regret_test_storage_path(v_org, v_exp_flow, v_tipo, v_tipo || '.pdf')
    );
  END LOOP;

  PERFORM public.__rpc_regret_test_set_auth(v_a1);
  SELECT public.enviar_retencion_mesa(v_exp_flow, 'con_sello') INTO v_result;
  PERFORM public.__rpc_regret_test_reset_auth();
  PERFORM public.__rpc_regret_test_assert((v_result->>'ok')::boolean = true, 'test 12: enviar_retencion_mesa ok');

  -- 13. avanzar 8→9 bloqueado con docs solo subidos (sin validar)
  PERFORM public.__rpc_regret_test_insert_cliente(v_exp_flow, v_org);
  PERFORM public.__rpc_regret_test_assert(
    EXISTS (
      SELECT 1 FROM public.retencion_envios re
      WHERE re.expediente_id = v_exp_flow AND re.enviado = true AND re.estado = 'enviado'
    ),
    'test 13: envío persistido'
  );

  PERFORM public.__rpc_regret_test_set_auth(v_mesa);
  BEGIN
    PERFORM public.avanzar_etapa_operativa(v_exp_flow);
    PERFORM public.__rpc_regret_test_reset_auth();
    RAISE EXCEPTION 'RPC REGRET TEST FAIL: test 13 debía fallar avance 8→9';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__rpc_regret_test_reset_auth();
    PERFORM public.__rpc_regret_test_assert(
      position('documentos de retención no validados' IN SQLERRM) > 0
        OR position('documento de retención faltante' IN SQLERRM) > 0,
      'test 13: avance 8→9 bloqueado sin validar'
    );
  END;

  -- 14. hook retención: rechazo mesa no rompe register resubida
  SELECT id INTO v_doc_id
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp_flow
    AND tipo_documento = 'retencion_acuse_con_sello'
    AND deleted_at IS NULL
  LIMIT 1;

  PERFORM public.__rpc_regret_test_set_auth(v_mesa);
  PERFORM public.update_documento_revision(v_doc_id, 'rechazado', 'Corregir sello');
  PERFORM public.__rpc_regret_test_reset_auth();

  PERFORM public.__rpc_regret_test_assert(
    EXISTS (
      SELECT 1 FROM public.retencion_envios re
      WHERE re.expediente_id = v_exp_flow AND re.estado = 'correccion_requerida'
    ),
    'test 14: hook correccion_requerida'
  );

  v_result := public.__rpc_regret_test_call(
    v_a1, v_exp_flow, 'retencion_acuse_con_sello',
    public.__rpc_regret_test_storage_path(v_org, v_exp_flow, 'retencion_acuse_con_sello', 'fix.pdf')
  );
  PERFORM public.__rpc_regret_test_assert(
    v_result->>'estatus_revision' = 'resubido', 'test 14b: resubida post-rechazo'
  );

  RAISE NOTICE 'RPC register_expediente_documento_retencion: 14 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_regret_test_insert_cliente(UUID, UUID, public.cliente_datos_estado);
DROP FUNCTION IF EXISTS public.__rpc_regret_test_expect_fail(UUID, UUID, TEXT, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.__rpc_regret_test_call(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS public.__rpc_regret_test_seed_storage(TEXT);
DROP FUNCTION IF EXISTS public.__rpc_regret_test_insert_exp(UUID, UUID, UUID, CHAR, SMALLINT, BOOLEAN, public.operativo_subestado, public.expediente_ciclo_estado);
DROP FUNCTION IF EXISTS public.__rpc_regret_test_storage_path(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_regret_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_regret_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_regret_test_assert(BOOLEAN, TEXT);
