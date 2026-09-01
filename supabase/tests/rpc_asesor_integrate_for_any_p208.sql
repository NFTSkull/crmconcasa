-- P208: captura delegada Equipo Silvia (team-scoped, Adriana/Hector).
-- Fixtures propias; cleanup por prefijo p208-test- / NSS 99882.
\set ON_ERROR_STOP on

\i supabase/tests/_p189_infonavit_datos_fixture.sql

CREATE OR REPLACE FUNCTION public.__p208_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P208 FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p208_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p208_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p208_storage_path(
  p_org UUID, p_exp UUID, p_tipo TEXT, p_suffix TEXT DEFAULT 'p208.pdf'
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/' || p_tipo || '/' || p_suffix;
$$;

-- =============================================================================
-- Contrato estático P208
-- =============================================================================
DO $$
DECLARE
  v_src TEXT;
  v_oid OID;
  v_names TEXT[] := ARRAY[
    'asesor_can_operate_expediente_as',
    'asesor_can_operate_expediente',
    'expediente_documento_storage_asesor_upload_allowed',
    'expediente_documento_storage_asesor_post_mesa_upload_allowed',
    'expediente_documento_storage_asesor_correccion_allowed',
    'expediente_documento_storage_asesor_retencion_upload_allowed'
  ];
  v_name TEXT;
BEGIN
  SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_comparten_equipo_activo'
  ORDER BY p.oid DESC
  LIMIT 1;
  PERFORM public.__p208_assert(v_oid IS NOT NULL, 'asesor_comparten_equipo_activo existe');
  PERFORM public.__p208_assert(
    position('asesor_equipos' in v_src) > 0
      AND position('asesor_pertenece_equipo_activo' in v_src) > 0,
    'asesor_comparten_equipo_activo usa relaciones equipo'
  );

  FOREACH v_name IN ARRAY v_names LOOP
    SELECT p.oid, pg_get_functiondef(p.oid) INTO v_oid, v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name
    ORDER BY p.oid DESC
    LIMIT 1;
    PERFORM public.__p208_assert(v_oid IS NOT NULL, v_name || ' existe');
    PERFORM public.__p208_assert(
      position('asesor_can_operate_expediente_as' in v_src) > 0
      OR position('integrate_for_any_advisor' in v_src) > 0,
      v_name || ' usa CAN_OPERATE o integrate'
    );
    PERFORM public.__p208_assert(
      position('v_exp.asesor_id IS DISTINCT FROM v_actor_id' in v_src) = 0,
      v_name || ' sin owner-only gate legacy'
    );
  END LOOP;

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'can_see_expediente'
  ORDER BY p.oid DESC LIMIT 1;
  PERFORM public.__p208_assert(
    position('integrate_for_any_advisor' in v_src) > 0,
    'can_see_expediente contiene integrate_for_any_advisor'
  );
  PERFORM public.__p208_assert(
    position('asesor_comparten_equipo_activo' in v_src) > 0,
    'can_see_expediente usa team scope'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_list_expedientes_page'
  ORDER BY p.oid DESC LIMIT 1;
  PERFORM public.__p208_assert(
    position('p_owner_asesor_id' in v_src) > 0,
    'asesor_list_expedientes_page p_owner_asesor_id'
  );

  RAISE NOTICE 'P208 OK: contrato estático';
END;
$$;

-- =============================================================================
-- T1–T26 comportamentales
-- =============================================================================
DO $$
DECLARE
  v_org UUID := gen_random_uuid();
  v_org2 UUID := gen_random_uuid();
  v_leader UUID := gen_random_uuid();
  v_owner_a UUID := gen_random_uuid();
  v_owner_b UUID := gen_random_uuid();
  v_owner_c UUID := gen_random_uuid();
  v_outsider UUID := gen_random_uuid();
  v_adriana UUID := gen_random_uuid();
  v_hector UUID := gen_random_uuid();
  v_normal UUID := gen_random_uuid();
  v_other_org UUID := gen_random_uuid();
  v_team UUID;
  v_team_inactive UUID;
  v_exp_b UUID;
  v_exp_c UUID;
  v_exp_post UUID;
  v_exp_reing UUID;
  v_exp_corr UUID;
  v_exp_gate UUID;
  v_exp_del UUID;
  v_exp_ciclo UUID;
  v_exp_outsider UUID;
  v_exp_leader UUID;
  v_created UUID;
  v_page JSONB;
  v_list JSONB;
  v_fail BOOLEAN;
  v_sqlstate TEXT;
  v_asesor_id UUID;
  v_actor UUID;
  v_uploaded_by UUID;
  v_updated_by UUID;
  v_path TEXT;
  v_allowed BOOLEAN;
  v_nss_b CHAR(11) := '99882000001';
  v_nss_c CHAR(11) := '99882000002';
  v_nss_create_b CHAR(11) := '99882000010';
  v_nss_create_c CHAR(11) := '99882000011';
  v_nss_post CHAR(11) := '99882000020';
  v_nss_reing CHAR(11) := '99882000021';
  v_nss_corr CHAR(11) := '99882000022';
  v_nss_gate CHAR(11) := '99882000023';
  v_nss_del CHAR(11) := '99882000024';
  v_nss_ciclo CHAR(11) := '99882000025';
  v_nss_enviar CHAR(11) := '99882000030';
  v_tipo TEXT;
BEGIN
  DELETE FROM public.action_log
  WHERE organization_id IN (SELECT id FROM public.organizations WHERE slug LIKE 'p208-test-%')
     OR entity_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%')
     OR actor_id IN (SELECT id FROM public.profiles WHERE email LIKE 'p208-test-%@test.local');
  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%');
  DELETE FROM public.cliente_datos
  WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%');
  DELETE FROM public.editor_decisions
  WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%');
  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%');
  DELETE FROM public.expedientes WHERE nss LIKE '99882%';
  DELETE FROM public.asesor_equipo_miembros
  WHERE team_id IN (SELECT id FROM public.asesor_equipos WHERE nombre LIKE 'P208 Test%');
  DELETE FROM public.asesor_equipos WHERE nombre LIKE 'P208 Test%';
  DELETE FROM public.profile_capabilities
  WHERE profile_id IN (v_adriana, v_hector);
  DELETE FROM public.profiles
  WHERE email LIKE 'p208-test-%@test.local';
  DELETE FROM public.organizations WHERE slug LIKE 'p208-test-%';

  INSERT INTO public.organizations (id, slug, name, active) VALUES
    (v_org, 'p208-test-' || substr(v_org::text, 1, 8), 'P208 Test Org', true),
    (v_org2, 'p208-test-' || substr(v_org2::text, 1, 8), 'P208 Test Org2', true);

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_leader, v_org, 'p208-test-leader@test.local', 'P208 Leader Silvia', 'asesor', 'interno', true),
    (v_owner_a, v_org, 'p208-test-owner-a@test.local', 'P208 Member A', 'asesor', 'interno', true),
    (v_owner_b, v_org, 'p208-test-owner-b@test.local', 'P208 Member B', 'asesor', 'interno', true),
    (v_owner_c, v_org, 'p208-test-owner-c@test.local', 'P208 Member C', 'asesor', 'interno', true),
    (v_outsider, v_org, 'p208-test-outsider@test.local', 'P208 Outsider Org', 'asesor', 'interno', true),
    (v_adriana, v_org, 'p208-test-adriana@test.local', 'P208 Adriana', 'asesor', 'interno', true),
    (v_hector, v_org, 'p208-test-hector@test.local', 'P208 Hector', 'asesor', 'interno', true),
    (v_normal, v_org, 'p208-test-normal@test.local', 'P208 Normal Team', 'asesor', 'interno', true),
    (v_other_org, v_org2, 'p208-test-otherorg@test.local', 'P208 OtherOrg', 'asesor', 'interno', true);

  INSERT INTO public.profile_capabilities (profile_id, capability, active) VALUES
    (v_adriana, 'create_for_any_advisor', true),
    (v_adriana, 'integrate_for_any_advisor', true),
    (v_hector, 'create_for_any_advisor', true),
    (v_hector, 'integrate_for_any_advisor', true);

  INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
  VALUES (gen_random_uuid(), v_org, 'P208 Test Team', v_leader, true)
  RETURNING id INTO v_team;

  INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active) VALUES
    (v_team, v_owner_a, true),
    (v_team, v_owner_b, true),
    (v_team, v_owner_c, true),
    (v_team, v_adriana, true),
    (v_team, v_hector, true),
    (v_team, v_normal, true);

  -- Expediente base Owner B (integración)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_b, 'mejoravit', v_nss_b, 'P208 Exp Owner B',
    '5582000001', '', 'interno', 'activo', false, 1, 'pendiente'
  );
  SELECT id INTO v_exp_b FROM public.expedientes WHERE nss = v_nss_b LIMIT 1;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_c, 'mejoravit', v_nss_c, 'P208 Exp Owner C',
    '5582000002', '', 'interno', 'activo', false, 1, 'pendiente'
  );
  SELECT id INTO v_exp_c FROM public.expedientes WHERE nss = v_nss_c LIMIT 1;

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, monto_aprobado_al_aprobar, aprobado_at
  ) VALUES
    (v_exp_b, v_org, 'aprobado', 15000, 15000, NOW()),
    (v_exp_c, v_org, 'aprobado', 15000, 15000, NOW());

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_leader, 'mejoravit', '99882000098', 'P208 Exp Leader',
    '5582000098', 'interno', 'activo', false, 1, 'pendiente'
  );
  SELECT id INTO v_exp_leader FROM public.expedientes WHERE nss = '99882000098' LIMIT 1;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_outsider, 'mejoravit', '99882000099', 'P208 Exp Outsider',
    '5582000099', 'interno', 'activo', false, 1, 'pendiente'
  );
  SELECT id INTO v_exp_outsider FROM public.expedientes WHERE nss = '99882000099' LIMIT 1;

  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado, monto_aprobado_al_aprobar, aprobado_at)
  VALUES
    (v_exp_leader, v_org, 'aprobado', 15000, 15000, NOW()),
    (v_exp_outsider, v_org, 'aprobado', 15000, 15000, NOW());

  -- T1 Adriana crea para Owner B
  PERFORM public.__p208_set_auth(v_adriana);
  v_page := public.create_expediente_for_asesor(
    v_owner_b, 'mejoravit', v_nss_create_b, 'P208 T1 Create B', '5582000010', ''
  );
  v_created := (v_page->>'id')::uuid;
  PERFORM public.__p208_assert((v_page->>'asesor_id')::uuid = v_owner_b, 'T1 asesor_id = Owner B');
  SELECT al.actor_id INTO v_actor FROM public.action_log al
  WHERE al.entity_id = v_created AND al.action = 'expediente.create'
  ORDER BY al.created_at DESC LIMIT 1;
  PERFORM public.__p208_assert(v_actor = v_adriana, 'T1 action_log actor Adriana');
  PERFORM public.__p208_reset_auth();

  -- T2 Hector crea para Owner C
  PERFORM public.__p208_set_auth(v_hector);
  v_page := public.create_expediente_for_asesor(
    v_owner_c, 'mejoravit', v_nss_create_c, 'P208 T2 Create C', '5582000011', ''
  );
  PERFORM public.__p208_assert((v_page->>'asesor_id')::uuid = v_owner_c, 'T2 asesor_id = Owner C');
  PERFORM public.__p208_reset_auth();

  -- T3 Adriana save_cliente_datos Owner B
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.save_cliente_datos(
    v_exp_b, 'XAXX010101000', '5582000101', '[]'::jsonb, NULL, '{}'::jsonb,
    'completo', 10, 'transferencia', 'Calle P208 B'
  );
  SELECT cd.updated_by INTO v_updated_by FROM public.cliente_datos cd WHERE cd.expediente_id = v_exp_b;
  PERFORM public.__p208_assert(v_updated_by = v_adriana, 'T3 updated_by Adriana');
  SELECT e.asesor_id INTO v_asesor_id FROM public.expedientes e WHERE e.id = v_exp_b;
  PERFORM public.__p208_assert(v_asesor_id = v_owner_b, 'T3 asesor_id sigue Owner B');
  PERFORM public.__p208_reset_auth();

  -- T4 Hector save_cliente_datos Owner C
  PERFORM public.__p208_set_auth(v_hector);
  PERFORM public.save_cliente_datos(
    v_exp_c, 'XAXX010101000', '5582000102', '[]'::jsonb, NULL, '{}'::jsonb,
    'completo', 10, 'transferencia', 'Calle P208 C'
  );
  SELECT cd.updated_by INTO v_updated_by FROM public.cliente_datos cd WHERE cd.expediente_id = v_exp_c;
  PERFORM public.__p208_assert(v_updated_by = v_hector, 'T4 updated_by Hector');
  PERFORM public.__p208_reset_auth();

  -- T5 Adriana Storage pre-Mesa Owner B
  v_path := public.__p208_storage_path(v_org, v_exp_b, 'cliente_ine_frente');
  PERFORM public.__p208_set_auth(v_adriana);
  v_allowed := public.expediente_documento_storage_asesor_upload_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS TRUE, 'T5 storage pre-Mesa Adriana');
  PERFORM public.__p208_reset_auth();

  -- T6 Adriana register doc pre-Mesa Owner B
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_adriana)
  ON CONFLICT (bucket_id, name) DO NOTHING;
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.register_expediente_documento(
    v_exp_b, 'cliente_ine_frente', v_path, 'ine.pdf', 'application/pdf', 100
  );
  SELECT d.uploaded_by INTO v_uploaded_by FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_b AND d.tipo_documento = 'cliente_ine_frente' AND d.deleted_at IS NULL
  LIMIT 1;
  PERFORM public.__p208_assert(v_uploaded_by = v_adriana, 'T6 uploaded_by Adriana');
  PERFORM public.__p208_reset_auth();

  -- T7 Hector Storage pre-Mesa Owner C
  v_path := public.__p208_storage_path(v_org, v_exp_c, 'cliente_comprobante_domicilio');
  PERFORM public.__p208_set_auth(v_hector);
  v_allowed := public.expediente_documento_storage_asesor_upload_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS TRUE, 'T7 storage pre-Mesa Hector');
  PERFORM public.__p208_reset_auth();

  -- T8 Hector register doc pre-Mesa Owner C
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_hector)
  ON CONFLICT (bucket_id, name) DO NOTHING;
  PERFORM public.__p208_set_auth(v_hector);
  PERFORM public.register_expediente_documento(
    v_exp_c, 'cliente_comprobante_domicilio', v_path, 'comp.pdf', 'application/pdf', 100
  );
  SELECT d.uploaded_by INTO v_uploaded_by FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_c AND d.tipo_documento = 'cliente_comprobante_domicilio' AND d.deleted_at IS NULL
  LIMIT 1;
  PERFORM public.__p208_assert(v_uploaded_by = v_hector, 'T8 uploaded_by Hector');
  PERFORM public.__p208_reset_auth();

  -- Post-Mesa expediente Owner B (reemplazo)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_b, 'mejoravit', v_nss_post, 'P208 Post Mesa B',
    '5582000020', 'interno', 'activo', true, 2, 'en_proceso'
  );
  SELECT id INTO v_exp_post FROM public.expedientes WHERE nss = v_nss_post LIMIT 1;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp_post, 'cliente_ine_frente',
    public.__p208_storage_path(v_org, v_exp_post, 'cliente_ine_frente', 'orig.pdf'),
    'orig.pdf', 'application/pdf', 100, 'subido', v_owner_b, 'asesor'
  );

  -- T9/T10 post-Mesa storage delegado
  v_path := public.__p208_storage_path(v_org, v_exp_post, 'cliente_ine_frente', 'replace.pdf');
  PERFORM public.__p208_set_auth(v_adriana);
  v_allowed := public.expediente_documento_storage_asesor_post_mesa_upload_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS TRUE, 'T10 storage post-Mesa delegado');
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_adriana) ON CONFLICT DO NOTHING;
  PERFORM public.register_expediente_documento(
    v_exp_post, 'cliente_ine_frente', v_path, 'replace.pdf', 'application/pdf', 100
  );
  SELECT d.uploaded_by INTO v_uploaded_by FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_post AND d.tipo_documento = 'cliente_ine_frente' AND d.deleted_at IS NULL
  ORDER BY d.created_at DESC LIMIT 1;
  PERFORM public.__p208_assert(v_uploaded_by = v_adriana, 'T9 uploaded_by Adriana post-Mesa');
  SELECT e.asesor_id INTO v_asesor_id FROM public.expedientes e WHERE e.id = v_exp_post;
  PERFORM public.__p208_assert(v_asesor_id = v_owner_b, 'T25 post-Mesa asesor_id Owner B');
  PERFORM public.__p208_reset_auth();

  -- T11 reingreso delegado (manual etapa 1 activo)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, reingreso_manual_count, reingreso_manual_at, reingreso_manual_by
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_c, 'mejoravit', v_nss_reing, 'P208 Reing C',
    '5582000021', 'interno', 'activo', true, NOW(), 1, 'en_validacion_mesa',
    1, NOW(), v_owner_c
  );
  SELECT id INTO v_exp_reing FROM public.expedientes WHERE nss = v_nss_reing LIMIT 1;
  PERFORM public.__p208_assert(
    public.es_reingreso_asesor_edicion_activa(v_exp_reing),
    'T11 reingreso activo fixture'
  );
  v_path := public.__p208_storage_path(v_org, v_exp_reing, 'cliente_ine_frente', 'reing.pdf');
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_hector) ON CONFLICT DO NOTHING;
  PERFORM public.__p208_set_auth(v_hector);
  PERFORM public.register_expediente_documento(
    v_exp_reing, 'cliente_ine_frente', v_path, 'reing.pdf', 'application/pdf', 100
  );
  SELECT d.uploaded_by INTO v_uploaded_by FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_reing AND d.tipo_documento = 'cliente_ine_frente' AND d.deleted_at IS NULL
  LIMIT 1;
  PERFORM public.__p208_assert(v_uploaded_by = v_hector, 'T11 reingreso uploaded_by Hector');
  PERFORM public.__p208_reset_auth();

  -- T12 doc opcional delegado
  v_path := public.__p208_storage_path(v_org, v_exp_b, 'cliente_estado_cuenta');
  PERFORM public.__p208_set_auth(v_adriana);
  v_allowed := public.expediente_documento_storage_asesor_upload_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS TRUE, 'T12 doc opcional storage');
  PERFORM public.__p208_reset_auth();

  -- T13 doc rechazado reenviado (corrección)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_b, 'mejoravit', v_nss_corr, 'P208 Correccion B',
    '5582000022', 'interno', 'activo', true, 2, 'en_proceso'
  );
  SELECT id INTO v_exp_corr FROM public.expedientes WHERE nss = v_nss_corr LIMIT 1;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp_corr, 'cliente_ine_frente',
    public.__p208_storage_path(v_org, v_exp_corr, 'cliente_ine_frente', 'rej.pdf'),
    'rej.pdf', 'application/pdf', 100, 'rechazado', v_owner_b, 'asesor'
  );
  v_path := public.__p208_storage_path(v_org, v_exp_corr, 'cliente_ine_frente', 'corr.pdf');
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', v_path, v_adriana) ON CONFLICT DO NOTHING;
  PERFORM public.__p208_set_auth(v_adriana);
  v_allowed := public.expediente_documento_storage_asesor_correccion_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS TRUE, 'T13 correccion storage delegado');
  PERFORM public.__p208_reset_auth();

  -- T14 save corrección delegado
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, porcentaje_cobro, monto_calculado, metodo_pago, updated_by
  ) VALUES (
    v_exp_corr, v_org, jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Antes'),
    'rechazado', 10, 1500, 'transferencia', v_owner_b
  );
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, monto_aprobado_al_aprobar, aprobado_at
  ) VALUES (v_exp_corr, v_org, 'aprobado', 15000, 15000, NOW());
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.save_cliente_datos_correccion(
    v_exp_corr, 'XAXX010101000', '5582000022', '[]'::jsonb, NULL,
    jsonb_build_object('rfc', 'XAXX010101000', 'nombreCliente', 'Corregido Perez'),
    10, 'transferencia', 'Dir corr', NULL
  );
  SELECT cd.updated_by INTO v_updated_by FROM public.cliente_datos cd WHERE cd.expediente_id = v_exp_corr;
  PERFORM public.__p208_assert(v_updated_by = v_adriana, 'T14 save corrección updated_by Adriana');
  PERFORM public.__p208_reset_auth();

  -- T15 enviar_a_mesa delegado
  IF to_regprocedure('public.__p189_clear_feature_vault()') IS NOT NULL THEN
    PERFORM public.__p189_clear_feature_vault();
  END IF;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_b, 'mejoravit', v_nss_enviar, 'P208 Enviar B',
    '5582000030', 'interno', 'activo', false, 1, 'pendiente'
  );
  SELECT id INTO v_created FROM public.expedientes WHERE nss = v_nss_enviar LIMIT 1;
  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado, monto_aprobado_al_aprobar, aprobado_at
  ) VALUES (v_created, v_org, 'aprobado', 15000, 15000, NOW());
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado, porcentaje_cobro, monto_calculado, metodo_pago, updated_by
  ) VALUES (
    v_created, v_org,
    public.__p189_infonavit_datos_completo(v_nss_enviar)
      || jsonb_build_object('rfc', 'XAXX010101000', 'celular', '5582000030'),
    'completo', 10, 1500, 'transferencia', v_adriana
  );
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento, storage_path,
      nombre_original, mime_type, size_bytes, estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      v_org, v_created, v_tipo, 'dev/p208/' || v_created::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100, 'subido', v_adriana, 'asesor'
    );
  END LOOP;
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.enviar_a_mesa(v_created);
  SELECT al.actor_id INTO v_actor FROM public.action_log al
  WHERE al.entity_id = v_created AND al.action = 'expediente.enviar_a_mesa'
  ORDER BY al.created_at DESC LIMIT 1;
  PERFORM public.__p208_assert(v_actor = v_adriana, 'T26 enviar action_log actor Adriana');
  SELECT e.asesor_id INTO v_asesor_id FROM public.expedientes e WHERE e.id = v_created;
  PERFORM public.__p208_assert(v_asesor_id = v_owner_b, 'T25 enviar asesor_id Owner B');
  PERFORM public.__p208_reset_auth();

  -- T16 normal advisor → Owner B deny
  PERFORM public.__p208_set_auth(v_normal);
  BEGIN
    PERFORM public.save_cliente_datos(
      v_exp_b, 'XAXX010101000', '5582999999', '[]'::jsonb, NULL, '{}'::jsonb,
      'completo', 10, 'transferencia', 'Deny'
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(v_fail AND v_sqlstate = '42501', 'T16 normal deny save');
  v_path := public.__p208_storage_path(v_org, v_exp_b, 'cliente_ine_reverso');
  v_allowed := public.expediente_documento_storage_asesor_upload_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS FALSE, 'T16 normal deny storage');
  PERFORM public.__p208_reset_auth();

  -- T17/T18 cross-org
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org2, v_other_org, 'mejoravit', '99882000999', 'P208 Other Org Exp',
    '5582000099', 'interno', 'activo', false, 1, 'pendiente'
  );
  SELECT id INTO v_created FROM public.expedientes WHERE nss = '99882000999' LIMIT 1;
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.__p208_assert(public.can_see_expediente(v_created) IS FALSE, 'T17 Adriana cross-org can_see');
  BEGIN
    PERFORM public.save_cliente_datos(
      v_created, 'XAXX010101000', '5582000099', '[]'::jsonb, NULL, '{}'::jsonb,
      'completo', 10, 'transferencia', 'Cross'
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__p208_assert(v_fail, 'T17 Adriana cross-org save deny');
  PERFORM public.__p208_reset_auth();

  PERFORM public.__p208_set_auth(v_hector);
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_other_org, 'mejoravit', '99882000998', 'P208 Cross Hector', '5582000098', ''
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__p208_assert(v_fail, 'T18 Hector cross-org create deny');
  PERFORM public.__p208_reset_auth();

  -- T19 capability inactive
  UPDATE public.profile_capabilities
  SET active = false
  WHERE profile_id = v_adriana AND capability = 'integrate_for_any_advisor';
  PERFORM public.__p208_set_auth(v_adriana);
  BEGIN
    PERFORM public.save_cliente_datos(
      v_exp_c, 'XAXX010101000', '5582000199', '[]'::jsonb, NULL, '{}'::jsonb,
      'completo', 10, 'transferencia', 'Cap off'
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(v_fail AND v_sqlstate = '42501', 'T19 capability inactive deny');
  PERFORM public.__p208_reset_auth();
  UPDATE public.profile_capabilities
  SET active = true
  WHERE profile_id = v_adriana AND capability = 'integrate_for_any_advisor';

  -- T20 expediente deleted
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado, deleted_at
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_b, 'mejoravit', v_nss_del, 'P208 Deleted',
    '5582000024', 'interno', 'activo', false, 1, 'pendiente', NOW()
  );
  SELECT id INTO v_exp_del FROM public.expedientes WHERE nss = v_nss_del LIMIT 1;
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.__p208_assert(public.can_see_expediente(v_exp_del) IS FALSE, 'T20 deleted can_see false');
  PERFORM public.__p208_assert(
    public.asesor_can_operate_expediente_as(v_adriana, v_exp_del) IS FALSE,
    'T20 deleted CAN_OPERATE false'
  );
  PERFORM public.__p208_reset_auth();

  -- T21 ciclo cerrado
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_b, 'mejoravit', v_nss_ciclo, 'P208 Ciclo Cerrado',
    '5582000025', 'interno', 'cerrado', false, 1, 'pendiente'
  );
  SELECT id INTO v_exp_ciclo FROM public.expedientes WHERE nss = v_nss_ciclo LIMIT 1;
  v_path := public.__p208_storage_path(v_org, v_exp_ciclo, 'cliente_ine_frente');
  PERFORM public.__p208_set_auth(v_adriana);
  v_allowed := public.expediente_documento_storage_asesor_upload_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS FALSE, 'T21 ciclo cerrado storage deny');
  PERFORM public.__p208_reset_auth();

  -- T22 stage gate (retención etapa≠8)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_b, 'mejoravit', v_nss_gate, 'P208 Gate Etapa',
    '5582000023', 'interno', 'activo', true, 5, 'en_proceso'
  );
  SELECT id INTO v_exp_gate FROM public.expedientes WHERE nss = v_nss_gate LIMIT 1;
  v_path := public.__p208_storage_path(v_org, v_exp_gate, 'cliente_acuse_retencion');
  PERFORM public.__p208_set_auth(v_adriana);
  BEGIN
    PERFORM public.register_expediente_documento_retencion(
      v_exp_gate, 'cliente_acuse_retencion', v_path, 'acuse.pdf', 'application/pdf', 100
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__p208_assert(v_fail, 'T22 stage gate retencion deny delegado');
  PERFORM public.__p208_set_auth(v_owner_b);
  BEGIN
    PERFORM public.register_expediente_documento_retencion(
      v_exp_gate, 'cliente_acuse_retencion', v_path, 'acuse-owner.pdf', 'application/pdf', 100
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__p208_assert(v_fail, 'T22 stage gate retencion deny owner también');
  PERFORM public.__p208_reset_auth();

  -- T23 tipo documento Mesa-only (no en integration_doc_tipos_asesor_upload)
  v_path := public.__p208_storage_path(v_org, v_exp_b, 'cliente_pagare');
  PERFORM public.__p208_set_auth(v_adriana);
  v_allowed := public.expediente_documento_storage_asesor_upload_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS FALSE, 'T23 mesa-only tipo deny storage');
  PERFORM public.__p208_reset_auth();

  -- T27 normal advisor inbox owner ajeno => NO
  PERFORM public.__p208_set_auth(v_normal);
  BEGIN
    v_page := public.asesor_list_expedientes_page(
      1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos', v_owner_b
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(
    v_fail AND v_sqlstate = '42501',
    'T27 normal advisor inbox owner ajeno deny'
  );
  PERFORM public.__p208_reset_auth();

  -- T28 delegate owner otro org => NO
  PERFORM public.__p208_set_auth(v_adriana);
  BEGIN
    v_page := public.asesor_list_expedientes_page(
      1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos', v_other_org
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(
    v_fail AND v_sqlstate = '42501',
    'T28 delegate owner otro org deny'
  );
  PERFORM public.__p208_reset_auth();

  -- T29 delegate abre expediente same-org => YES (can_see + CAN_OPERATE)
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.__p208_assert(
    public.can_see_expediente(v_exp_b) IS TRUE,
    'T29 can_see delegate same-org'
  );
  PERFORM public.__p208_assert(
    public.asesor_can_operate_expediente_as(v_adriana, v_exp_b) IS TRUE,
    'T29 CAN_OPERATE delegate same-org'
  );
  PERFORM public.__p208_reset_auth();

  -- T30 delegate mesa_take => NO (rol asesor)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_owner_b, 'mejoravit', '99882000040', 'P208 Mesa Take',
    '5582000040', 'interno', 'activo', true, 2, 'en_proceso'
  );
  SELECT id INTO v_created FROM public.expedientes WHERE nss = '99882000040' LIMIT 1;
  PERFORM public.__p208_set_auth(v_adriana);
  BEGIN
    PERFORM public.mesa_take_expediente(v_created);
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(
    v_fail AND v_sqlstate = '42501',
    'T30 delegate mesa_take deny'
  );
  PERFORM public.__p208_reset_auth();

  -- T31 delegate Pago ConCasa => NO
  PERFORM public.__p208_set_auth(v_hector);
  BEGIN
    PERFORM public.decidir_pago_concasa(v_exp_post, 'pagado', 'test');
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(
    v_fail AND v_sqlstate = '42501',
    'T31 delegate Pago ConCasa deny'
  );
  PERFORM public.__p208_reset_auth();

  -- T32 delegate agenda Mesa (book_biometricos owner gate) => NO
  PERFORM public.__p208_set_auth(v_adriana);
  BEGIN
    PERFORM public.book_biometricos(
      v_exp_b,
      NOW() + INTERVAL '7 days',
      '00000000-0000-4000-8000-000000000001'::uuid
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(v_fail, 'T32 delegate book_biometricos deny');
  PERFORM public.__p208_reset_auth();

  -- T33 delegate avanzar etapa Mesa => NO
  PERFORM public.__p208_set_auth(v_hector);
  BEGIN
    PERFORM public.mesa_mover_etapa_operativa(
      v_exp_post, 3::smallint, 2::smallint, 'P208 test deny'
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__p208_assert(v_fail, 'T33 delegate mesa_mover_etapa deny');
  PERFORM public.__p208_reset_auth();

  -- =============================================================================
  -- T34–T50 team scope (Equipo Silvia)
  -- =============================================================================
  PERFORM public.__p208_assert(
    public.asesor_comparten_equipo_activo(v_adriana, v_leader),
    'helper: Adriana comparte team con leader'
  );
  PERFORM public.__p208_assert(
    NOT public.asesor_comparten_equipo_activo(v_adriana, v_outsider),
    'helper: Adriana NO comparte team con outsider'
  );

  -- T34 Adriana -> leader
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.save_cliente_datos(
    v_exp_leader, 'XAXX010101000', '5582000098', '[]'::jsonb, NULL, '{}'::jsonb,
    'completo', 10, 'transferencia', 'Leader dir'
  );
  PERFORM public.__p208_assert(
    public.asesor_can_operate_expediente_as(v_adriana, v_exp_leader),
    'T34 Adriana CAN_OPERATE leader'
  );
  PERFORM public.__p208_reset_auth();

  -- T35 Hector -> leader
  PERFORM public.__p208_set_auth(v_hector);
  PERFORM public.__p208_assert(
    public.asesor_can_operate_expediente_as(v_hector, v_exp_leader),
    'T35 Hector CAN_OPERATE leader'
  );
  PERFORM public.__p208_reset_auth();

  -- T36 Adriana -> member A
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.__p208_assert(
    public.asesor_comparten_equipo_activo(v_adriana, v_owner_a),
    'T36 Adriana member A shared team'
  );
  PERFORM public.__p208_reset_auth();

  -- T37 Hector -> member B
  PERFORM public.__p208_set_auth(v_hector);
  PERFORM public.__p208_assert(
    public.asesor_can_operate_expediente_as(v_hector, v_exp_b),
    'T37 Hector member B'
  );
  PERFORM public.__p208_reset_auth();

  -- T38 Adriana -> outsider same-org
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.__p208_assert(
    public.can_see_expediente(v_exp_outsider) IS FALSE,
    'T50 can_see outsider NO (T38 precursor)'
  );
  BEGIN
    PERFORM public.save_cliente_datos(
      v_exp_outsider, 'XAXX010101000', '5582000099', '[]'::jsonb, NULL, '{}'::jsonb,
      'completo', 10, 'transferencia', 'Outsider deny'
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(v_fail AND v_sqlstate = '42501', 'T38 Adriana outsider deny');
  v_path := public.__p208_storage_path(v_org, v_exp_outsider, 'cliente_ine_frente');
  v_allowed := public.expediente_documento_storage_asesor_upload_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS FALSE, 'T48 storage pre outsider');
  PERFORM public.__p208_reset_auth();

  -- T39 Hector -> outsider
  PERFORM public.__p208_set_auth(v_hector);
  BEGIN
    PERFORM public.save_cliente_datos(
      v_exp_outsider, 'XAXX010101000', '5582000099', '[]'::jsonb, NULL, '{}'::jsonb,
      'completo', 10, 'transferencia', 'Outsider deny H'
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__p208_assert(v_fail, 'T39 Hector outsider deny');
  PERFORM public.__p208_reset_auth();

  -- T40 normal team member sin capability
  PERFORM public.__p208_set_auth(v_normal);
  BEGIN
    PERFORM public.save_cliente_datos(
      v_exp_b, 'XAXX010101000', '5582000190', '[]'::jsonb, NULL, '{}'::jsonb,
      'completo', 10, 'transferencia', 'Normal deny'
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(v_fail AND v_sqlstate = '42501', 'T40 normal sin cap deny');
  PERFORM public.__p208_reset_auth();

  -- T41 membership actor inactive
  UPDATE public.asesor_equipo_miembros SET active = false
  WHERE team_id = v_team AND asesor_id = v_adriana;
  PERFORM public.__p208_set_auth(v_adriana);
  BEGIN
    PERFORM public.save_cliente_datos(
      v_exp_b, 'XAXX010101000', '5582000191', '[]'::jsonb, NULL, '{}'::jsonb,
      'completo', 10, 'transferencia', 'Inactive member'
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(v_fail AND v_sqlstate = '42501', 'T41 actor membership inactive');
  PERFORM public.__p208_reset_auth();
  UPDATE public.asesor_equipo_miembros SET active = true
  WHERE team_id = v_team AND asesor_id = v_adriana;

  -- T42 membership target inactive
  UPDATE public.asesor_equipo_miembros SET active = false
  WHERE team_id = v_team AND asesor_id = v_owner_b;
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.__p208_assert(
    public.asesor_comparten_equipo_activo(v_adriana, v_owner_b) IS FALSE,
    'T42 shared team false when target inactive'
  );
  PERFORM public.__p208_reset_auth();
  UPDATE public.asesor_equipo_miembros SET active = true
  WHERE team_id = v_team AND asesor_id = v_owner_b;

  -- T43 team inactive
  UPDATE public.asesor_equipos SET active = false WHERE id = v_team;
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.__p208_assert(
    public.asesor_comparten_equipo_activo(v_adriana, v_owner_b) IS FALSE,
    'T43 team inactive'
  );
  PERFORM public.__p208_reset_auth();
  UPDATE public.asesor_equipos SET active = true WHERE id = v_team;

  -- T44 target leader shared team YES
  PERFORM public.__p208_assert(
    public.asesor_comparten_equipo_activo(v_hector, v_leader),
    'T44 Hector shared team with leader'
  );

  -- T45 cross-org (reuse T17 logic on outsider org exp)
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.__p208_assert(
    public.asesor_comparten_equipo_activo(v_adriana, v_other_org) IS FALSE,
    'T45 cross-org comparten false'
  );
  PERFORM public.__p208_reset_auth();

  -- T46 create_for_any target fuera team
  PERFORM public.__p208_set_auth(v_adriana);
  BEGIN
    PERFORM public.create_expediente_for_asesor(
      v_outsider, 'mejoravit', '99882000050', 'P208 Create Outsider', '5582000050', ''
    );
    v_fail := false;
    v_sqlstate := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_sqlstate := SQLSTATE;
  END;
  PERFORM public.__p208_assert(v_fail AND v_sqlstate = '42501', 'T46 create outsider deny');
  PERFORM public.__p208_reset_auth();

  -- T47 integrate outsider deny (already T38)

  -- T49 storage post outsider (submitted exp)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, ciclo_estado, submitted_to_mesa, etapa_actual, subestado
  ) VALUES (
    gen_random_uuid(), v_org, v_outsider, 'mejoravit', '99882000051', 'P208 Post Outsider',
    '5582000051', 'interno', 'activo', true, 2, 'en_proceso'
  );
  SELECT id INTO v_created FROM public.expedientes WHERE nss = '99882000051' LIMIT 1;
  v_path := public.__p208_storage_path(v_org, v_created, 'cliente_ine_frente');
  PERFORM public.__p208_set_auth(v_hector);
  v_allowed := public.expediente_documento_storage_asesor_post_mesa_upload_allowed(v_path);
  PERFORM public.__p208_assert(v_allowed IS FALSE, 'T49 storage post outsider');
  PERFORM public.__p208_reset_auth();

  -- list_asesores_activos_org team-scoped
  PERFORM public.__p208_set_auth(v_adriana);
  v_list := public.list_asesores_activos_org();
  PERFORM public.__p208_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list->'asesores') x
      WHERE (x->>'id')::uuid = v_leader
    ),
    'list_asesores incluye leader team'
  );
  PERFORM public.__p208_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list->'asesores') x
      WHERE (x->>'id')::uuid = v_outsider
    ),
    'list_asesores excluye outsider'
  );
  PERFORM public.__p208_reset_auth();

  -- can_see + inbox delegado (team member)
  PERFORM public.__p208_set_auth(v_adriana);
  PERFORM public.__p208_assert(public.can_see_expediente(v_exp_b) IS TRUE, 'can_see delegado Owner B');
  v_page := public.asesor_list_expedientes_page(1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos', v_owner_b);
  PERFORM public.__p208_assert(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_page->'items') x
      WHERE (x->>'id')::uuid = v_exp_b
    ),
    'inbox delegado lista Owner B'
  );
  PERFORM public.__p208_reset_auth();

  -- Cleanup
  DELETE FROM public.action_log
  WHERE organization_id IN (SELECT id FROM public.organizations WHERE slug LIKE 'p208-test-%')
     OR entity_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%');
  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%');
  DELETE FROM public.cliente_datos
  WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%');
  DELETE FROM public.editor_decisions
  WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%');
  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE nss LIKE '99882%');
  DELETE FROM public.expedientes WHERE nss LIKE '99882%';
  DELETE FROM public.asesor_equipo_miembros WHERE team_id = v_team;
  DELETE FROM public.asesor_equipos WHERE id = v_team;
  DELETE FROM public.profile_capabilities WHERE profile_id IN (v_adriana, v_hector);
  DELETE FROM public.profiles WHERE email LIKE 'p208-test-%@test.local';
  DELETE FROM public.organizations WHERE slug LIKE 'p208-test-%';

  RAISE NOTICE 'P208 OK: T1–T50';
END;
$$;

DROP FUNCTION IF EXISTS public.__p208_storage_path(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__p208_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__p208_reset_auth();
DROP FUNCTION IF EXISTS public.__p208_assert(BOOLEAN, TEXT);
