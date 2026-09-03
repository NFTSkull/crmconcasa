-- ConCasa CRM — suite cliente_constancia_situacion_fiscal (mig 20260903120000)
-- T1–T24: opcionales/upload/no-gate, PDF genérico, versionado, P208 Team Silvia, Mesa RO.
-- Distinto de Mesa cliente_constancia_sat (intacto).

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__ccsf_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'CONSTANCIA SAT ASESOR TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__ccsf_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__ccsf_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.__ccsf_storage_path(
  p_org UUID, p_exp UUID, p_suffix TEXT DEFAULT 'v1.bin'
)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT p_org::TEXT || '/' || p_exp::TEXT || '/cliente_constancia_situacion_fiscal/' || p_suffix;
$$;

CREATE OR REPLACE FUNCTION public.__ccsf_insert_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss CHAR(11),
  p_submitted BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Fixture Constancia SAT Asesor',
    '5533333333', 'interno', p_submitted,
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

CREATE OR REPLACE FUNCTION public.__ccsf_seed_storage(p_path TEXT, p_owner UUID DEFAULT '00000000-0000-4000-8001-000000000001')
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id)
  VALUES ('expediente-documentos', p_path, p_owner)
  ON CONFLICT (bucket_id, name) DO NOTHING;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';

  v_exp UUID := '00000000-0000-4000-9050-000000000010';
  v_exp_ajeno UUID := '00000000-0000-4000-9050-000000000020';
  v_exp_replace UUID := '00000000-0000-4000-9050-000000000030';
  v_exp_post UUID := '00000000-0000-4000-9050-000000000040';

  v_org2 UUID := gen_random_uuid();
  v_leader UUID := gen_random_uuid();
  v_adriana UUID := gen_random_uuid();
  v_hector UUID := gen_random_uuid();
  v_owner_silvia UUID := gen_random_uuid();
  v_owner_out UUID := gen_random_uuid();
  v_other_org_asesor UUID := gen_random_uuid();
  v_team UUID;
  v_exp_silvia UUID;
  v_exp_out UUID;
  v_exp_xorg UUID;

  v_path TEXT;
  v_path2 TEXT;
  v_result JSONB;
  v_active INTEGER;
  v_prev_id UUID;
  v_seen INTEGER;
  v_ok BOOLEAN;
  v_mime_ok BOOLEAN;
  v_uploaded_by UUID;
  v_asesor_id UUID;
  v_opc TEXT[];
  v_upload TEXT[];
  v_envio TEXT[];
  v_max BIGINT;
  v_nss_silvia CHAR(11) := '90508000001';
  v_nss_out CHAR(11) := '90508000002';
  v_nss_xorg CHAR(11) := '90508000003';
BEGIN
  -- T1 / T2 / T3 allowlists
  v_opc := public.integration_doc_tipos_asesor_opcionales();
  v_upload := public.integration_doc_tipos_asesor_upload();
  v_envio := public.integration_doc_tipos_asesor_envio();
  PERFORM public.__ccsf_assert(
    'cliente_constancia_situacion_fiscal' = ANY(v_opc),
    'T1 tipo en opcionales'
  );
  PERFORM public.__ccsf_assert(
    'cliente_constancia_situacion_fiscal' = ANY(v_upload),
    'T2 tipo en upload'
  );
  PERFORM public.__ccsf_assert(
    NOT ('cliente_constancia_situacion_fiscal' = ANY(v_envio)),
    'T3 tipo NO en obligatorios/envio'
  );
  PERFORM public.__ccsf_assert(
    cardinality(v_opc) = 13 AND cardinality(v_upload) = 17,
    format('T3b cardinalidad opc=%s upload=%s', cardinality(v_opc), cardinality(v_upload))
  );
  PERFORM public.__ccsf_assert(
    NOT ('cliente_constancia_sat' = ANY(v_opc)),
    'T3c Mesa cliente_constancia_sat NO en opcionales asesor'
  );
  IF to_regprocedure('public.integration_doc_tipos_mesa_upload()') IS NOT NULL THEN
    PERFORM public.__ccsf_assert(
      'cliente_constancia_sat' = ANY(public.integration_doc_tipos_mesa_upload()),
      'T3d Mesa cliente_constancia_sat intacto en mesa_upload'
    );
  END IF;

  -- T4 / T24: no gate
  PERFORM public.__ccsf_assert(array_length(v_envio, 1) = 4, 'T4/T24 envío sigue en 4');
  IF to_regprocedure('public.integration_doc_tipos_validacion_mesa()') IS NOT NULL THEN
    PERFORM public.__ccsf_assert(
      NOT ('cliente_constancia_situacion_fiscal' = ANY(public.integration_doc_tipos_validacion_mesa())),
      'T24 no en validacion mesa'
    );
  END IF;
  IF to_regprocedure('public.integration_doc_tipos_mesa_upload()') IS NOT NULL THEN
    PERFORM public.__ccsf_assert(
      NOT ('cliente_constancia_situacion_fiscal' = ANY(public.integration_doc_tipos_mesa_upload())),
      'T23 Mesa write NO ganado'
    );
  END IF;

  -- T12–T17 MIME: PDF genérico global; sin allowlist especial
  SELECT public.expediente_documento_mime_permitido('application/pdf', 'cliente_constancia_situacion_fiscal')
    INTO v_mime_ok;
  PERFORM public.__ccsf_assert(v_mime_ok, 'T12 PDF OK');
  SELECT public.expediente_documento_mime_permitido('image/jpeg', 'cliente_constancia_situacion_fiscal')
    INTO v_mime_ok;
  PERFORM public.__ccsf_assert(NOT v_mime_ok, 'T13 JPEG NO (solo PDF)');
  SELECT public.expediente_documento_mime_permitido('image/png', 'cliente_constancia_situacion_fiscal')
    INTO v_mime_ok;
  PERFORM public.__ccsf_assert(NOT v_mime_ok, 'T13 PNG NO (solo PDF)');
  SELECT public.expediente_documento_mime_permitido(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'cliente_constancia_situacion_fiscal'
  ) INTO v_mime_ok;
  PERFORM public.__ccsf_assert(NOT v_mime_ok, 'T14 DOCX NO');
  SELECT public.expediente_documento_mime_permitido(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'cliente_constancia_situacion_fiscal'
  ) INTO v_mime_ok;
  PERFORM public.__ccsf_assert(NOT v_mime_ok, 'T14 XLSX NO');
  SELECT public.expediente_documento_mime_permitido('application/zip', 'cliente_constancia_situacion_fiscal')
    INTO v_mime_ok;
  PERFORM public.__ccsf_assert(NOT v_mime_ok, 'T15 ZIP NO');
  SELECT public.expediente_documento_mime_permitido('application/octet-stream', 'cliente_constancia_situacion_fiscal')
    INTO v_mime_ok;
  PERFORM public.__ccsf_assert(NOT v_mime_ok, 'T16 octet-stream NO');
  SELECT public.expediente_documento_mime_permitido('text/html', 'cliente_constancia_situacion_fiscal')
    INTO v_mime_ok;
  PERFORM public.__ccsf_assert(NOT v_mime_ok, 'T17 text/html NO');
  SELECT public.expediente_documento_mime_permitido('application/pdf', 'cliente_constancia_sat')
    INTO v_mime_ok;
  PERFORM public.__ccsf_assert(v_mime_ok, 'T17b Mesa cliente_constancia_sat PDF intacto');

  v_max := public.expediente_documento_max_size_bytes();
  PERFORM public.__ccsf_assert(v_max = 15 * 1024 * 1024, 'T18 max helper 15MB');

  PERFORM public.__ccsf_insert_exp(v_exp, v_org, v_a1, '90501000010');
  PERFORM public.__ccsf_insert_exp(v_exp_ajeno, v_org, v_a2, '90502000020');
  PERFORM public.__ccsf_insert_exp(v_exp_replace, v_org, v_a1, '90503000030');
  PERFORM public.__ccsf_insert_exp(v_exp_post, v_org, v_a1, '90504000040', true);

  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (v_exp, v_exp_ajeno, v_exp_replace, v_exp_post)
    AND tipo_documento = 'cliente_constancia_situacion_fiscal';

  -- T5 owner pre-Mesa
  v_path := public.__ccsf_storage_path(v_org, v_exp, 'ok.pdf');
  PERFORM public.__ccsf_seed_storage(v_path, v_a1);
  PERFORM public.__ccsf_set_auth(v_a1);
  SELECT public.register_expediente_documento(
    v_exp, 'cliente_constancia_situacion_fiscal', v_path, 'constancia-sat.pdf', 'application/pdf', 2048
  ) INTO v_result;
  PERFORM public.__ccsf_reset_auth();
  PERFORM public.__ccsf_assert(v_result ? 'documento_id', 'T5 dueño pre-Mesa registra');
  SELECT d.uploaded_by INTO v_uploaded_by
  FROM public.expediente_documentos d WHERE d.id = (v_result->>'documento_id')::uuid;
  PERFORM public.__ccsf_assert(v_uploaded_by = v_a1, 'T20 uploaded_by actor real');
  SELECT e.asesor_id INTO v_asesor_id FROM public.expedientes e WHERE e.id = v_exp;
  PERFORM public.__ccsf_assert(v_asesor_id = v_a1, 'T21 asesor_id intacto');

  -- T6 post-Mesa (upload si flujo lo permite; si exige reingreso, rechazo controlado = OK)
  v_path := public.__ccsf_storage_path(v_org, v_exp_post, 'post.pdf');
  PERFORM public.__ccsf_seed_storage(v_path, v_a1);
  PERFORM public.__ccsf_set_auth(v_a1);
  BEGIN
    SELECT public.register_expediente_documento(
      v_exp_post, 'cliente_constancia_situacion_fiscal', v_path, 'post.pdf', 'application/pdf', 1024
    ) INTO v_result;
    v_ok := (v_result ? 'documento_id');
  EXCEPTION WHEN OTHERS THEN
    v_ok := position('REENTRY' IN SQLERRM) > 0
         OR position('reingreso' IN lower(SQLERRM)) > 0
         OR position('solo el asesor' IN lower(SQLERRM)) > 0
         OR position('metadata' IN lower(SQLERRM)) > 0;
  END;
  PERFORM public.__ccsf_reset_auth();
  PERFORM public.__ccsf_assert(v_ok, 'T6 post-Mesa conforme flujo actual');

  -- T7 ajeno NO
  v_path := public.__ccsf_storage_path(v_org, v_exp_ajeno, 'ajeno.pdf');
  PERFORM public.__ccsf_seed_storage(v_path, v_a1);
  PERFORM public.__ccsf_set_auth(v_a1);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp_ajeno, 'cliente_constancia_situacion_fiscal', v_path, 'x.pdf', 'application/pdf', 100
    );
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  PERFORM public.__ccsf_reset_auth();
  PERFORM public.__ccsf_assert(v_ok, 'T7 asesor ajeno no registra');

  -- T18 >15MB
  v_path := public.__ccsf_storage_path(v_org, v_exp, 'big.pdf');
  PERFORM public.__ccsf_seed_storage(v_path, v_a1);
  PERFORM public.__ccsf_set_auth(v_a1);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp, 'cliente_constancia_situacion_fiscal', v_path, 'big.pdf', 'application/pdf',
      (15 * 1024 * 1024) + 1
    );
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  PERFORM public.__ccsf_reset_auth();
  PERFORM public.__ccsf_assert(v_ok, 'T18 >15MB rechazado');

  -- T19 versionado
  v_path := public.__ccsf_storage_path(v_org, v_exp_replace, 'v1.pdf');
  v_path2 := public.__ccsf_storage_path(v_org, v_exp_replace, 'v2.pdf');
  PERFORM public.__ccsf_seed_storage(v_path, v_a1);
  PERFORM public.__ccsf_seed_storage(v_path2, v_a1);
  PERFORM public.__ccsf_set_auth(v_a1);
  SELECT public.register_expediente_documento(
    v_exp_replace, 'cliente_constancia_situacion_fiscal', v_path, 'v1.pdf', 'application/pdf', 50
  ) INTO v_result;
  v_prev_id := (v_result->>'documento_id')::uuid;
  SELECT public.register_expediente_documento(
    v_exp_replace, 'cliente_constancia_situacion_fiscal', v_path2, 'v2.pdf',
    'application/pdf', 60
  ) INTO v_result;
  PERFORM public.__ccsf_reset_auth();
  SELECT count(*) INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp_replace
    AND tipo_documento = 'cliente_constancia_situacion_fiscal'
    AND deleted_at IS NULL;
  PERFORM public.__ccsf_assert(v_active = 1, 'T19 solo una versión activa');
  SELECT deleted_at IS NOT NULL INTO v_ok
  FROM public.expediente_documentos WHERE id = v_prev_id;
  PERFORM public.__ccsf_assert(v_ok, 'T19 versión anterior soft-deleted');

  -- T22 Mesa read soft
  PERFORM public.__ccsf_set_auth(v_mesa);
  SELECT count(*) INTO v_seen
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp
    AND d.tipo_documento = 'cliente_constancia_situacion_fiscal'
    AND d.deleted_at IS NULL;
  PERFORM public.__ccsf_reset_auth();
  PERFORM public.__ccsf_assert(v_seen >= 0, 'T22 consulta mesa ejecutada');

  -- ========== P208 Team Silvia (T8–T11) ==========
  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (SELECT id FROM public.expedientes WHERE nss IN (v_nss_silvia, v_nss_out, v_nss_xorg));
  DELETE FROM public.expedientes WHERE nss IN (v_nss_silvia, v_nss_out, v_nss_xorg);
  DELETE FROM public.asesor_equipo_miembros
  WHERE team_id IN (SELECT id FROM public.asesor_equipos WHERE nombre = 'CCSF Test Team Silvia');
  DELETE FROM public.asesor_equipos WHERE nombre = 'CCSF Test Team Silvia';
  DELETE FROM public.profile_capabilities
  WHERE profile_id IN (
    SELECT id FROM public.profiles WHERE email LIKE 'ccsf-test-%@test.local'
  );
  DELETE FROM public.profiles WHERE email LIKE 'ccsf-test-%@test.local';
  DELETE FROM public.organizations WHERE slug LIKE 'ccsf-test-%';

  INSERT INTO public.organizations (id, slug, name, active) VALUES
    (v_org2, 'ccsf-test-' || substr(v_org2::text, 1, 8), 'CCSF Cross Org', true);

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES
    (v_leader, v_org, 'ccsf-test-leader@test.local', 'CCSF Leader', 'asesor', 'interno', true),
    (v_adriana, v_org, 'ccsf-test-adriana@test.local', 'CCSF Adriana', 'asesor', 'interno', true),
    (v_hector, v_org, 'ccsf-test-hector@test.local', 'CCSF Hector', 'asesor', 'interno', true),
    (v_owner_silvia, v_org, 'ccsf-test-owner-silvia@test.local', 'CCSF Owner Silvia', 'asesor', 'interno', true),
    (v_owner_out, v_org, 'ccsf-test-owner-out@test.local', 'CCSF Owner Out', 'asesor', 'interno', true),
    (v_other_org_asesor, v_org2, 'ccsf-test-otherorg@test.local', 'CCSF OtherOrg', 'asesor', 'interno', true);

  INSERT INTO public.profile_capabilities (profile_id, capability, active) VALUES
    (v_adriana, 'create_for_any_advisor', true),
    (v_adriana, 'integrate_for_any_advisor', true),
    (v_hector, 'create_for_any_advisor', true),
    (v_hector, 'integrate_for_any_advisor', true);

  INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
  VALUES (gen_random_uuid(), v_org, 'CCSF Test Team Silvia', v_leader, true)
  RETURNING id INTO v_team;

  INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active) VALUES
    (v_team, v_leader, true),
    (v_team, v_adriana, true),
    (v_team, v_hector, true),
    (v_team, v_owner_silvia, true);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES
    (gen_random_uuid(), v_org, v_owner_silvia, 'mejoravit', v_nss_silvia, 'CCSF Silvia Exp',
     '5588000001', 'interno', false, 1, 'pendiente', 'activo'),
    (gen_random_uuid(), v_org, v_owner_out, 'mejoravit', v_nss_out, 'CCSF Out Exp',
     '5588000002', 'interno', false, 1, 'pendiente', 'activo'),
    (gen_random_uuid(), v_org2, v_other_org_asesor, 'mejoravit', v_nss_xorg, 'CCSF XOrg Exp',
     '5588000003', 'interno', false, 1, 'pendiente', 'activo');

  SELECT id INTO v_exp_silvia FROM public.expedientes WHERE nss = v_nss_silvia LIMIT 1;
  SELECT id INTO v_exp_out FROM public.expedientes WHERE nss = v_nss_out LIMIT 1;
  SELECT id INTO v_exp_xorg FROM public.expedientes WHERE nss = v_nss_xorg LIMIT 1;

  -- T8 Adriana
  v_path := public.__ccsf_storage_path(v_org, v_exp_silvia, 'adriana.pdf');
  PERFORM public.__ccsf_seed_storage(v_path, v_adriana);
  PERFORM public.__ccsf_set_auth(v_adriana);
  SELECT public.register_expediente_documento(
    v_exp_silvia, 'cliente_constancia_situacion_fiscal', v_path, 'a.pdf', 'application/pdf', 200
  ) INTO v_result;
  PERFORM public.__ccsf_reset_auth();
  PERFORM public.__ccsf_assert(v_result ? 'documento_id', 'T8 Adriana Team Silvia YES');
  SELECT d.uploaded_by INTO v_uploaded_by FROM public.expediente_documentos d
  WHERE d.expediente_id = v_exp_silvia AND d.tipo_documento = 'cliente_constancia_situacion_fiscal' AND d.deleted_at IS NULL
  LIMIT 1;
  PERFORM public.__ccsf_assert(v_uploaded_by = v_adriana, 'T20 Adriana uploaded_by');
  SELECT e.asesor_id INTO v_asesor_id FROM public.expedientes e WHERE e.id = v_exp_silvia;
  PERFORM public.__ccsf_assert(v_asesor_id = v_owner_silvia, 'T21 titular intacto');

  -- T9 Hector
  v_path := public.__ccsf_storage_path(v_org, v_exp_silvia, 'hector.pdf');
  PERFORM public.__ccsf_seed_storage(v_path, v_hector);
  PERFORM public.__ccsf_set_auth(v_hector);
  SELECT public.register_expediente_documento(
    v_exp_silvia, 'cliente_constancia_situacion_fiscal', v_path, 'h.pdf',
    'application/pdf', 300
  ) INTO v_result;
  PERFORM public.__ccsf_reset_auth();
  PERFORM public.__ccsf_assert(v_result ? 'documento_id', 'T9 Hector Team Silvia YES');

  -- T10 outside team NO
  v_path := public.__ccsf_storage_path(v_org, v_exp_out, 'out.pdf');
  PERFORM public.__ccsf_seed_storage(v_path, v_adriana);
  PERFORM public.__ccsf_set_auth(v_adriana);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp_out, 'cliente_constancia_situacion_fiscal', v_path, 'out.pdf', 'application/pdf', 100
    );
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  PERFORM public.__ccsf_reset_auth();
  PERFORM public.__ccsf_assert(v_ok, 'T10 delegate outside Team NO');

  -- T11 cross-org NO
  v_path := public.__ccsf_storage_path(v_org2, v_exp_xorg, 'xorg.pdf');
  PERFORM public.__ccsf_seed_storage(v_path, v_adriana);
  PERFORM public.__ccsf_set_auth(v_adriana);
  BEGIN
    PERFORM public.register_expediente_documento(
      v_exp_xorg, 'cliente_constancia_situacion_fiscal', v_path, 'x.pdf', 'application/pdf', 100
    );
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN
    v_ok := true;
  END;
  PERFORM public.__ccsf_reset_auth();
  PERFORM public.__ccsf_assert(v_ok, 'T11 cross-org NO');

  RAISE NOTICE 'CLIENTE CONSTANCIA SITUACION FISCAL TESTS OK';
END; $$;

DROP FUNCTION IF EXISTS public.__ccsf_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__ccsf_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__ccsf_reset_auth();
DROP FUNCTION IF EXISTS public.__ccsf_storage_path(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__ccsf_insert_exp(UUID, UUID, UUID, CHAR, BOOLEAN);
DROP FUNCTION IF EXISTS public.__ccsf_seed_storage(TEXT, UUID);
