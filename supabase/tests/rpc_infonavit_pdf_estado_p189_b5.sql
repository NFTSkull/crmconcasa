-- ConCasa CRM — P189 B5 tests: read model UI Documentos INFONAVIT
-- LOCAL: aplicar 187, luego este archivo. NO Cloud.
-- Fixtures NSS 1870% / org …9187… (no choca B4 1850 / B4.1 1860).

\set ON_ERROR_STOP on
\i supabase/tests/_p189_infonavit_datos_fixture.sql
\i supabase/migrations/187_infonavit_pdf_read_model.sql

CREATE OR REPLACE FUNCTION public.__p189_b5_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P189 B5 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_purge()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('infonavit.snapshot_mutable', '1', true);
  DELETE FROM public.infonavit_pdf_outbox
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1870%'
  );
  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1870%'
  )
    AND tipo_documento LIKE 'infonavit_%';
  DELETE FROM public.expediente_infonavit_submission_snapshots
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1870%'
  );
  PERFORM set_config('infonavit.snapshot_mutable', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_seed_user(
  p_id UUID, p_org UUID, p_email TEXT, p_role public.app_role, p_active BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    p_id, 'authenticated', 'authenticated', p_email,
    crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  IF p_role IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, tipo_asesor_origen, active
  ) VALUES (
    p_id, p_org, p_email, p_email, p_role,
    CASE p_role
      WHEN 'mesa_interno' THEN 'interno'::public.origen_mesa
      WHEN 'mesa_externo' THEN 'externo'::public.origen_mesa
      ELSE NULL
    END,
    CASE WHEN p_role = 'asesor' THEN 'interno'::public.tipo_asesor_origen ELSE NULL END,
    p_active
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    app_role = EXCLUDED.app_role,
    active = EXCLUDED.active;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_seed_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss TEXT,
  p_programa public.programa, p_origen public.origen_mesa, p_submitted BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual,
    subestado, ciclo_estado, direccion_opcional
  ) VALUES (
    p_id, p_org, p_asesor, p_programa, p_nss,
    'Fixture P189 B5', '5511111111', p_origen, p_submitted,
    1, 'pendiente', 'activo', 'Av Siempre Viva 123'
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    asesor_id = EXCLUDED.asesor_id,
    programa = EXCLUDED.programa,
    nss = EXCLUDED.nss,
    origen_mesa = EXCLUDED.origen_mesa,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    ciclo_estado = 'activo',
    deleted_at = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_put_submission(
  p_org UUID, p_exp UUID, p_version INTEGER, p_kind TEXT
)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_payload JSONB := '{"schemaVersion":1,"mark":"b5"}'::JSONB;
  v_hash TEXT;
  v_snap UUID;
  v_tipo TEXT;
BEGIN
  v_hash := public.infonavit_pdf_payload_sha256(v_payload);

  SELECT s.id INTO v_snap
  FROM public.expediente_infonavit_submission_snapshots s
  WHERE s.expediente_id = p_exp AND s.submission_version = p_version;

  IF v_snap IS NULL THEN
    INSERT INTO public.expediente_infonavit_submission_snapshots (
      organization_id, expediente_id, submission_version, submission_kind,
      template_version, snapshot_hash, payload, fecha_documento
    ) VALUES (
      p_org, p_exp, p_version, p_kind, 'v1', v_hash, v_payload, CURRENT_DATE
    )
    RETURNING id INTO v_snap;
  END IF;

  FOREACH v_tipo IN ARRAY public.infonavit_pdf_auto_document_types()
  LOOP
    INSERT INTO public.infonavit_pdf_outbox (
      organization_id, expediente_id, snapshot_id, document_type,
      submission_version, template_version, template_sha256, snapshot_hash, status
    ) VALUES (
      p_org, p_exp, v_snap, v_tipo, p_version, 'v1',
      public.infonavit_pdf_template_sha256(v_tipo), v_hash, 'pending'
    )
    ON CONFLICT (
      expediente_id, document_type, submission_version, template_version, snapshot_hash
    ) DO UPDATE SET
      status = 'pending',
      documento_id = NULL,
      last_error_code = NULL,
      processed_at = NULL;
  END LOOP;

  RETURN v_snap;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_mark_done(
  p_org UUID, p_exp UUID, p_version INTEGER, p_tipo TEXT, p_uploader UUID
)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_doc UUID;
  v_outbox UUID;
  v_path TEXT;
  v_name TEXT;
BEGIN
  SELECT o.id INTO v_outbox
  FROM public.infonavit_pdf_outbox o
  WHERE o.expediente_id = p_exp
    AND o.document_type = p_tipo
    AND o.submission_version = p_version;

  v_path := p_org::text || '/' || p_exp::text || '/' || p_tipo || '/' || v_outbox::text || '.pdf';
  v_name := CASE p_tipo
    WHEN 'infonavit_carta_bajo_protesta' THEN 'Carta Bajo Protesta.pdf'
    WHEN 'infonavit_presupuesto_mejoramiento' THEN 'Presupuesto de Mejoramiento.pdf'
    ELSE 'Solicitud de Inscripción de Crédito.pdf'
  END;

  UPDATE public.expediente_documentos
  SET deleted_at = NOW()
  WHERE expediente_id = p_exp
    AND tipo_documento = p_tipo
    AND deleted_at IS NULL;

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento,
    storage_path, nombre_original, mime_type, size_bytes,
    version, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    p_org, p_exp, p_tipo, v_path, v_name, 'application/pdf', 2048,
    p_version + 1, 'subido', p_uploader, 'sistema'
  )
  RETURNING id INTO v_doc;

  UPDATE public.infonavit_pdf_outbox
  SET status = 'done', documento_id = v_doc, processed_at = NOW(), last_error_code = NULL
  WHERE id = v_outbox;

  RETURN v_doc;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_mark_failed(
  p_exp UUID, p_version INTEGER, p_tipo TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.infonavit_pdf_outbox
  SET status = 'failed', last_error_code = 'INFONAVIT_RENDER_FAILED', processed_at = NOW()
  WHERE expediente_id = p_exp
    AND document_type = p_tipo
    AND submission_version = p_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_set_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_estado_as(p_user UUID, p_exp UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_res JSONB;
BEGIN
  PERFORM public.__p189_b5_set_auth(p_user);
  SELECT public.get_expediente_infonavit_pdf_estado(p_exp) INTO v_res;
  PERFORM public.__p189_b5_reset_auth();
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_denied(p_user UUID, p_exp UUID)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.__p189_b5_set_auth(p_user);
  BEGIN
    PERFORM public.get_expediente_infonavit_pdf_estado(p_exp);
    PERFORM public.__p189_b5_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__p189_b5_reset_auth();
      RETURN SQLSTATE = '42501' OR SQLSTATE = '42500';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_storage_as(p_user UUID, p_path TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  PERFORM public.__p189_b5_set_auth(p_user);
  SELECT public.expediente_documento_storage_can_read(p_path) INTO v_ok;
  PERFORM public.__p189_b5_reset_auth();
  RETURN COALESCE(v_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b5_json_has_pii(p_json JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_txt TEXT := lower(p_json::text);
BEGIN
  RETURN v_txt ~ '"(nss|curp|rfc|celular|telefono|correo|direccion|payload|snapshot_hash|template_sha256|last_error_code|uploaded_by|worker_secret|attempts)"';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9187-000000000100';
  v_org2 UUID := '00000000-0000-4000-9187-000000000200';
  v_asesor UUID := '00000000-0000-4000-9187-000000000111';
  v_ajeno UUID := '00000000-0000-4000-9187-000000000112';
  v_mesa_admin UUID := '00000000-0000-4000-9187-000000000121';
  v_mesa_int UUID := '00000000-0000-4000-9187-000000000122';
  v_mesa_ext UUID := '00000000-0000-4000-9187-000000000123';
  v_editor UUID := '00000000-0000-4000-9187-000000000131';
  v_noprof UUID := '00000000-0000-4000-9187-000000000141';
  v_inactive UUID := '00000000-0000-4000-9187-000000000142';
  v_org2_asesor UUID := '00000000-0000-4000-9187-000000000211';
  v_exp_pending UUID := '00000000-0000-4000-9187-000000000001';
  v_exp_done UUID := '00000000-0000-4000-9187-000000000002';
  v_exp_reing UUID := '00000000-0000-4000-9187-000000000003';
  v_exp_fail UUID := '00000000-0000-4000-9187-000000000004';
  v_exp_legacy UUID := '00000000-0000-4000-9187-000000000005';
  v_exp_sub UUID := '00000000-0000-4000-9187-000000000006';
  v_exp_ext UUID := '00000000-0000-4000-9187-000000000008';
  v_exp_org2 UUID := '00000000-0000-4000-9187-000000000007';
  v_res JSONB;
  v_docs JSONB;
  v_doc JSONB;
  v_s1_carta UUID;
  v_s2_carta UUID;
  v_path TEXT;
  v_ok BOOLEAN;
  v_exec BOOLEAN;
  v_tipo TEXT;
BEGIN
  PERFORM public.__p189_b5_purge();
  PERFORM set_config('role', 'postgres', true);

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES
    (v_org, 'p189-b5-org', 'P189 B5 Org', true),
    (v_org2, 'p189-b5-org2', 'P189 B5 Org 2', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  PERFORM public.__p189_b5_seed_user(v_asesor, v_org, 'p189-b5-asesor@test.local', 'asesor', true);
  PERFORM public.__p189_b5_seed_user(v_ajeno, v_org, 'p189-b5-ajeno@test.local', 'asesor', true);
  PERFORM public.__p189_b5_seed_user(v_mesa_admin, v_org, 'p189-b5-mesa-admin@test.local', 'mesa_admin', true);
  PERFORM public.__p189_b5_seed_user(v_mesa_int, v_org, 'p189-b5-mesa-int@test.local', 'mesa_interno', true);
  PERFORM public.__p189_b5_seed_user(v_mesa_ext, v_org, 'p189-b5-mesa-ext@test.local', 'mesa_externo', true);
  PERFORM public.__p189_b5_seed_user(v_editor, v_org, 'p189-b5-editor@test.local', 'editor', true);
  PERFORM public.__p189_b5_seed_user(v_inactive, v_org, 'p189-b5-inactive@test.local', 'asesor', false);
  PERFORM public.__p189_b5_seed_user(v_noprof, v_org, 'p189-b5-noprof@test.local', NULL::public.app_role, true);
  PERFORM public.__p189_b5_seed_user(v_org2_asesor, v_org2, 'p189-b5-org2@test.local', 'asesor', true);

  PERFORM public.__p189_b5_seed_exp(v_exp_pending, v_org, v_asesor, '18700000001', 'mejoravit', 'interno', true);
  PERFORM public.__p189_b5_seed_exp(v_exp_done, v_org, v_asesor, '18700000002', 'mejoravit', 'interno', true);
  PERFORM public.__p189_b5_seed_exp(v_exp_reing, v_org, v_asesor, '18700000003', 'mejoravit', 'interno', true);
  PERFORM public.__p189_b5_seed_exp(v_exp_fail, v_org, v_asesor, '18700000004', 'mejoravit', 'interno', true);
  PERFORM public.__p189_b5_seed_exp(v_exp_legacy, v_org, v_asesor, '18700000005', 'mejoravit', 'interno', true);
  PERFORM public.__p189_b5_seed_exp(v_exp_sub, v_org, v_asesor, '18700000006', 'subcuenta', 'interno', true);
  PERFORM public.__p189_b5_seed_exp(v_exp_ext, v_org, v_asesor, '18700000008', 'mejoravit', 'externo', true);
  PERFORM public.__p189_b5_seed_exp(v_exp_org2, v_org2, v_org2_asesor, '18700000007', 'mejoravit', 'interno', true);

  PERFORM public.__p189_b5_put_submission(v_org, v_exp_pending, 0, 'initial');
  PERFORM public.__p189_b5_put_submission(v_org, v_exp_done, 0, 'initial');
  PERFORM public.__p189_b5_put_submission(v_org, v_exp_reing, 0, 'initial');
  PERFORM public.__p189_b5_put_submission(v_org, v_exp_fail, 0, 'initial');
  PERFORM public.__p189_b5_put_submission(v_org, v_exp_ext, 0, 'initial');
  PERFORM public.__p189_b5_put_submission(v_org2, v_exp_org2, 0, 'initial');

  FOREACH v_tipo IN ARRAY public.infonavit_pdf_auto_document_types()
  LOOP
    PERFORM public.__p189_b5_mark_done(v_org, v_exp_done, 0, v_tipo, v_asesor);
    PERFORM public.__p189_b5_mark_done(v_org, v_exp_reing, 0, v_tipo, v_asesor);
    PERFORM public.__p189_b5_mark_done(v_org, v_exp_fail, 0, v_tipo, v_asesor);
  END LOOP;

  -- Grants
  SELECT has_function_privilege(
    'authenticated', 'public.get_expediente_infonavit_pdf_estado(uuid)', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b5_assert(v_exec, 'authenticated EXECUTE read model');

  SELECT has_function_privilege(
    'anon', 'public.get_expediente_infonavit_pdf_estado(uuid)', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b5_assert(NOT v_exec, 'anon NO EXECUTE read model');

  SELECT has_function_privilege(
    'authenticated', 'public.infonavit_pdf_read_allowed(uuid)', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b5_assert(NOT v_exec, 'authenticated NO EXECUTE helper read_allowed');

  -- anon role
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.get_expediente_infonavit_pdf_estado(v_exp_pending);
    PERFORM public.__p189_b5_assert(false, 'anon debió denegar');
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
    WHEN OTHERS THEN
      PERFORM public.__p189_b5_assert(
        SQLSTATE IN ('42501', '42500'),
        'anon denied: ' || SQLERRM
      );
  END;
  RESET ROLE;
  PERFORM public.__p189_b5_reset_auth();

  PERFORM public.__p189_b5_assert(
    public.__p189_b5_denied(v_noprof, v_exp_pending),
    'sin perfil denied'
  );
  PERFORM public.__p189_b5_assert(
    public.__p189_b5_denied(v_inactive, v_exp_pending),
    'perfil inactivo denied'
  );
  PERFORM public.__p189_b5_assert(
    public.__p189_b5_denied(v_asesor, v_exp_pending),
    'asesor owner denied B8'
  );
  PERFORM public.__p189_b5_assert(
    public.__p189_b5_denied(v_ajeno, v_exp_pending),
    'asesor ajeno denied'
  );
  PERFORM public.__p189_b5_assert(
    NOT public.__p189_b5_denied(v_mesa_admin, v_exp_pending),
    'mesa_admin visible allowed'
  );
  PERFORM public.__p189_b5_assert(
    NOT public.__p189_b5_denied(v_mesa_int, v_exp_pending),
    'mesa_interno origen interno allowed'
  );
  PERFORM public.__p189_b5_assert(
    public.__p189_b5_denied(v_mesa_int, v_exp_ext),
    'mesa_interno origen externo denied'
  );
  PERFORM public.__p189_b5_assert(
    public.__p189_b5_denied(v_mesa_ext, v_exp_pending),
    'mesa_externo origen interno denied'
  );
  PERFORM public.__p189_b5_assert(
    public.__p189_b5_denied(v_editor, v_exp_pending),
    'editor denied'
  );
  PERFORM public.__p189_b5_assert(
    public.__p189_b5_denied(v_org2_asesor, v_exp_pending),
    'otra org denied'
  );

  -- Non-Mejoravit (mesa_admin; asesor denied en B8)
  v_res := public.__p189_b5_estado_as(v_mesa_admin, v_exp_sub);
  PERFORM public.__p189_b5_assert(v_res->>'aplica' = 'false', 'subcuenta aplica=false');
  PERFORM public.__p189_b5_assert(
    COALESCE(jsonb_array_length(v_res->'documents'), 0) = 0,
    'subcuenta documents vacíos'
  );

  -- Legacy sin snapshot (mesa_admin)
  v_res := public.__p189_b5_estado_as(v_mesa_admin, v_exp_legacy);
  PERFORM public.__p189_b5_assert(v_res->>'aplica' = 'true', 'legacy aplica=true');
  PERFORM public.__p189_b5_assert(v_res->>'has_submission' = 'false', 'legacy has_submission=false');
  PERFORM public.__p189_b5_assert(
    COALESCE(jsonb_array_length(v_res->'documents'), 0) = 0,
    'legacy documents vacíos'
  );

  -- Initial pending (mesa_admin)
  v_res := public.__p189_b5_estado_as(v_mesa_admin, v_exp_pending);
  PERFORM public.__p189_b5_assert(v_res->>'aplica' = 'true', 'pending aplica');
  PERFORM public.__p189_b5_assert(v_res->>'has_submission' = 'true', 'pending has_submission');
  PERFORM public.__p189_b5_assert((v_res->>'submission_version')::int = 0, 'pending version 0');
  PERFORM public.__p189_b5_assert(v_res->>'submission_kind' = 'initial', 'pending kind initial');
  PERFORM public.__p189_b5_assert(jsonb_array_length(v_res->'documents') = 3, 'pending 3 docs');
  FOR v_doc IN SELECT * FROM jsonb_array_elements(v_res->'documents')
  LOOP
    PERFORM public.__p189_b5_assert(v_doc->>'status' = 'pending', 'pending status');
    PERFORM public.__p189_b5_assert(v_doc->>'latest_document' IS NULL, 'pending latest null');
    PERFORM public.__p189_b5_assert(v_doc->>'previous_document' IS NULL, 'pending previous null');
  END LOOP;
  PERFORM public.__p189_b5_assert(
    NOT public.__p189_b5_json_has_pii(v_res),
    'pending JSON sin PII/infra'
  );

  -- Done
  v_res := public.__p189_b5_estado_as(v_mesa_admin, v_exp_done);
  PERFORM public.__p189_b5_assert((v_res->>'submission_version')::int = 0, 'done version 0');
  FOR v_doc IN SELECT * FROM jsonb_array_elements(v_res->'documents')
  LOOP
    PERFORM public.__p189_b5_assert(v_doc->>'status' = 'done', 'done status');
    PERFORM public.__p189_b5_assert(v_doc->'latest_document' ? 'id', 'done latest id');
    PERFORM public.__p189_b5_assert(
      (v_doc->'latest_document'->>'mime_type') = 'application/pdf',
      'done mime pdf'
    );
    PERFORM public.__p189_b5_assert(v_doc->>'previous_document' IS NULL, 'done previous null');
  END LOOP;

  -- Reingreso S2 pending + previous S1
  PERFORM public.__p189_b5_put_submission(v_org, v_exp_reing, 1, 'reingreso');
  v_res := public.__p189_b5_estado_as(v_mesa_admin, v_exp_reing);
  PERFORM public.__p189_b5_assert((v_res->>'submission_version')::int = 1, 'reingreso latest=1');
  PERFORM public.__p189_b5_assert(v_res->>'submission_kind' = 'reingreso', 'kind reingreso');
  FOR v_doc IN SELECT * FROM jsonb_array_elements(v_res->'documents')
  LOOP
    PERFORM public.__p189_b5_assert(v_doc->>'status' = 'pending', 'S2 pending');
    PERFORM public.__p189_b5_assert(v_doc->>'latest_document' IS NULL, 'S2 latest null');
    PERFORM public.__p189_b5_assert(v_doc->'previous_document' ? 'id', 'S1 previous');
  END LOOP;
  SELECT (d->'previous_document'->>'id')::uuid INTO v_s1_carta
  FROM jsonb_array_elements(v_res->'documents') d
  WHERE d->>'document_type' = 'infonavit_carta_bajo_protesta';

  FOREACH v_tipo IN ARRAY public.infonavit_pdf_auto_document_types()
  LOOP
    v_s2_carta := public.__p189_b5_mark_done(v_org, v_exp_reing, 1, v_tipo, v_asesor);
  END LOOP;
  v_res := public.__p189_b5_estado_as(v_mesa_admin, v_exp_reing);
  FOR v_doc IN SELECT * FROM jsonb_array_elements(v_res->'documents')
  LOOP
    PERFORM public.__p189_b5_assert(v_doc->>'status' = 'done', 'S2 done');
    PERFORM public.__p189_b5_assert(v_doc->'latest_document' ? 'id', 'S2 latest');
    PERFORM public.__p189_b5_assert(v_doc->>'previous_document' IS NULL, 'S2 no previous vigente');
  END LOOP;
  SELECT (d->'latest_document'->>'id')::uuid INTO v_s2_carta
  FROM jsonb_array_elements(v_res->'documents') d
  WHERE d->>'document_type' = 'infonavit_carta_bajo_protesta';
  PERFORM public.__p189_b5_assert(v_s2_carta IS DISTINCT FROM v_s1_carta, 'latest es S2 no S1');

  -- Failed + previous
  PERFORM public.__p189_b5_put_submission(v_org, v_exp_fail, 1, 'reingreso');
  PERFORM public.__p189_b5_mark_failed(v_exp_fail, 1, 'infonavit_carta_bajo_protesta');
  FOREACH v_tipo IN ARRAY ARRAY[
    'infonavit_presupuesto_mejoramiento',
    'infonavit_solicitud_inscripcion'
  ]
  LOOP
    PERFORM public.__p189_b5_mark_done(v_org, v_exp_fail, 1, v_tipo, v_asesor);
  END LOOP;
  v_res := public.__p189_b5_estado_as(v_mesa_admin, v_exp_fail);
  SELECT d INTO v_doc
  FROM jsonb_array_elements(v_res->'documents') d
  WHERE d->>'document_type' = 'infonavit_carta_bajo_protesta';
  PERFORM public.__p189_b5_assert(v_doc->>'status' = 'failed', 'failed status');
  PERFORM public.__p189_b5_assert(v_doc->>'latest_document' IS NULL, 'failed latest null');
  PERFORM public.__p189_b5_assert(v_doc->'previous_document' ? 'id', 'failed previous S1');
  PERFORM public.__p189_b5_assert(
    NOT public.__p189_b5_json_has_pii(v_res),
    'failed JSON sin last_error_code/PII'
  );

  -- Storage can_read (policy existente, sin policy nueva)
  SELECT o.organization_id::text || '/' || o.expediente_id::text || '/' || o.document_type
           || '/' || o.id::text || '.pdf'
    INTO v_path
  FROM public.infonavit_pdf_outbox o
  WHERE o.expediente_id = v_exp_done
    AND o.document_type = 'infonavit_carta_bajo_protesta'
    AND o.submission_version = 0;
  PERFORM public.__p189_b5_assert(
    public.__p189_b5_storage_as(v_asesor, v_path),
    'storage owner OK'
  );
  PERFORM public.__p189_b5_assert(
    public.__p189_b5_storage_as(v_mesa_admin, v_path),
    'storage mesa OK'
  );
  PERFORM public.__p189_b5_assert(
    NOT public.__p189_b5_storage_as(v_ajeno, v_path),
    'storage ajeno DENIED'
  );
  PERFORM public.__p189_b5_assert(
    NOT public.__p189_b5_storage_as(v_org2_asesor, v_path),
    'storage otra org DENIED'
  );

  -- P189 no está en allowlists de upload/envio/obligatorios
  PERFORM public.__p189_b5_assert(
    NOT ('infonavit_carta_bajo_protesta' = ANY (public.integration_doc_tipos_asesor_upload())),
    'P189 fuera upload asesor'
  );
  PERFORM public.__p189_b5_assert(
    NOT ('infonavit_carta_bajo_protesta' = ANY (public.integration_doc_tipos_asesor_envio())),
    'P189 fuera envio'
  );
  PERFORM public.__p189_b5_assert(
    NOT ('infonavit_carta_bajo_protesta' = ANY (public.integration_doc_tipos_obligatorios())),
    'P189 fuera obligatorios'
  );

  RAISE NOTICE 'P189 B5 SQL PASS';
END;
$$;
