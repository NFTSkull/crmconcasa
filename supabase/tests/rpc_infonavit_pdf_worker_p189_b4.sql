-- ConCasa CRM — P189 B4 tests: claim/fail/complete + out-of-order + RLS
-- LOCAL: aplicar 183+184+185, luego este archivo.

\set ON_ERROR_STOP on
\i supabase/tests/_p189_infonavit_datos_fixture.sql

CREATE OR REPLACE FUNCTION public.__p189_b4_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P189 B4 TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b4_put_object(p_path TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('expediente-documentos', p_path, jsonb_build_object('mimetype', 'application/pdf'))
  ON CONFLICT (bucket_id, name) DO UPDATE SET metadata = EXCLUDED.metadata;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b4_purge()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('infonavit.snapshot_mutable', '1', true);
  DELETE FROM public.infonavit_pdf_outbox
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1850%'
  );
  DELETE FROM public.expediente_documentos
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1850%'
  )
    AND tipo_documento LIKE 'infonavit_%';
  DELETE FROM public.expediente_infonavit_submission_snapshots
  WHERE expediente_id IN (
    SELECT id FROM public.expedientes WHERE nss LIKE '1850%'
  );
  PERFORM set_config('infonavit.snapshot_mutable', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b4_seed_exp(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual,
    subestado, ciclo_estado, direccion_opcional
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss,
    'Fixture P189 B4', '5511111111', 'interno', false,
    1, 'pendiente', 'activo', 'Av Siempre Viva 123'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    ciclo_estado = 'activo',
    deleted_at = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b4_seed_ready(
  p_id UUID, p_org UUID, p_asesor UUID, p_nss TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_tipo TEXT;
BEGIN
  PERFORM public.__p189_b4_seed_exp(p_id, p_org, p_asesor, p_nss);
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision, monto_aprobado)
  VALUES (p_id, p_org, 'aprobado', 150000)
  ON CONFLICT (expediente_id) DO UPDATE SET decision = 'aprobado', monto_aprobado = 150000;

  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago
  ) VALUES (
    p_id, p_org, public.__p189_infonavit_datos_completo(p_nss),
    'completo', 10, 11000, 'transferencia'
  )
  ON CONFLICT (expediente_id) DO UPDATE SET
    datos = EXCLUDED.datos, estado = 'completo';

  DELETE FROM public.expediente_documentos
  WHERE expediente_id = p_id
    AND tipo_documento = ANY (public.integration_doc_tipos_asesor_envio());
  FOREACH v_tipo IN ARRAY public.integration_doc_tipos_asesor_envio()
  LOOP
    INSERT INTO public.expediente_documentos (
      organization_id, expediente_id, tipo_documento,
      storage_path, nombre_original, mime_type, size_bytes,
      estatus_revision, uploaded_by, uploaded_by_role
    ) VALUES (
      p_org, p_id, v_tipo,
      'dev/p189b4/' || p_id::text || '/' || v_tipo || '.pdf',
      v_tipo || '.pdf', 'application/pdf', 100,
      'subido', p_asesor, 'asesor'
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b4_e2e_reingreso(p_expediente_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_asesor UUID;
  v_res JSONB;
BEGIN
  SELECT e.asesor_id INTO v_asesor FROM public.expedientes e WHERE e.id = p_expediente_id;
  UPDATE public.cliente_datos
  SET datos = jsonb_set(
    datos,
    '{infonavit,mejora,descripcion}',
    '"Cambio de pisos y pintura interior ficticia"'::jsonb
  )
  WHERE expediente_id = p_expediente_id;
  UPDATE public.expedientes
  SET etapa_actual = 4,
      subestado = 'en_proceso',
      reingreso_manual_at = NOW() - INTERVAL '1 minute'
  WHERE id = p_expediente_id;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  SELECT public.asesor_enviar_reingreso_a_mesa(p_expediente_id) INTO v_res;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v_res;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b4_e2e_bootstrap()
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_org UUID := '00000000-0000-4000-9185-000000000100';
  v_asesor UUID := '00000000-0000-4000-9185-000000000111';
  v_exp UUID := '00000000-0000-4000-9185-000000000090';
  v_ids UUID[];
BEGIN
  PERFORM public.__p189_purge_submission(v_exp);
  DELETE FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento LIKE 'infonavit_%';
  PERFORM public.__p189_b4_seed_ready(v_exp, v_org, v_asesor, '18500000090');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  PERFORM public.enviar_a_mesa(v_exp);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  SELECT array_agg(o.id ORDER BY o.document_type) INTO v_ids
  FROM public.infonavit_pdf_outbox o WHERE o.expediente_id = v_exp;

  RETURN jsonb_build_object(
    'expediente_id', v_exp,
    'organization_id', v_org,
    'asesor_id', v_asesor,
    'outbox_ids', to_jsonb(v_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.__p189_b4_put_job(
  p_outbox_id UUID,
  p_org UUID,
  p_exp UUID,
  p_type TEXT,
  p_version INTEGER,
  p_payload JSONB DEFAULT '{"schemaVersion":1,"mark":"b4"}'::JSONB
)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_snap UUID;
  v_hash TEXT;
BEGIN
  v_hash := public.infonavit_pdf_payload_sha256(p_payload);

  SELECT s.id INTO v_snap
  FROM public.expediente_infonavit_submission_snapshots s
  WHERE s.expediente_id = p_exp AND s.submission_version = p_version;

  IF v_snap IS NULL THEN
    INSERT INTO public.expediente_infonavit_submission_snapshots (
      organization_id, expediente_id, submission_version, submission_kind,
      template_version, snapshot_hash, payload, fecha_documento
    ) VALUES (
      p_org, p_exp, p_version,
      CASE WHEN p_version = 0 THEN 'initial' ELSE 'reingreso' END,
      'v1', v_hash, p_payload, CURRENT_DATE
    )
    RETURNING id INTO v_snap;
  END IF;

  INSERT INTO public.infonavit_pdf_outbox (
    id, organization_id, expediente_id, snapshot_id, document_type,
    submission_version, template_version, template_sha256, snapshot_hash, status
  ) VALUES (
    p_outbox_id, p_org, p_exp, v_snap, p_type, p_version, 'v1',
    public.infonavit_pdf_template_sha256(p_type), v_hash, 'pending'
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'pending',
    attempts = 0,
    available_at = NOW(),
    processing_started_at = NULL,
    processed_at = NULL,
    documento_id = NULL,
    last_error_code = NULL;

  RETURN v_snap;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-9185-000000000100';
  v_asesor UUID := '00000000-0000-4000-9185-000000000111';
  v_exp UUID := '00000000-0000-4000-9185-000000000001';
  v_exp2 UUID := '00000000-0000-4000-9185-000000000002';
  v_exp3 UUID := '00000000-0000-4000-9185-000000000003';
  v_exp4 UUID := '00000000-0000-4000-9185-000000000004';
  v_exp5 UUID := '00000000-0000-4000-9185-000000000005';
  v_o1 UUID := '00000000-0000-4000-9185-00000000aa01';
  v_o2 UUID := '00000000-0000-4000-9185-00000000aa02';
  v_o3 UUID := '00000000-0000-4000-9185-00000000aa03';
  v_s1 UUID := '00000000-0000-4000-9185-00000000bb01';
  v_s2 UUID := '00000000-0000-4000-9185-00000000bb02';
  v_r1 UUID := '00000000-0000-4000-9185-00000000cc01';
  v_t1 UUID := '00000000-0000-4000-9185-00000000dd01';
  v_path TEXT;
  v_path2 TEXT;
  v_claim JSONB;
  v_fail JSONB;
  v_done JSONB;
  v_done2 JSONB;
  v_load JSONB;
  v_status TEXT;
  v_attempts INTEGER;
  v_active UUID;
  v_del TIMESTAMPTZ;
  v_ver INTEGER;
  v_cnt INTEGER;
  v_exec BOOLEAN;
  v_err TEXT;
  v_avail TIMESTAMPTZ;
BEGIN
  PERFORM public.__p189_b4_purge();
  PERFORM set_config('role', 'postgres', true);
  PERFORM public.__p189_enable_feature_active();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'p189-b4-org', 'P189 B4 Org', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_asesor, 'authenticated', 'authenticated', 'p189-b4-asesor@test.local',
    crypt('x', gen_salt('bf')), NOW(), '{}', '{}', NOW(), NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES (
    v_asesor, v_org, 'p189-b4-asesor@test.local', 'Asesor P189 B4',
    'asesor', 'interno', true
  )
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, active = true;

  PERFORM public.__p189_b4_seed_exp(v_exp, v_org, v_asesor, '18500000001');
  PERFORM public.__p189_b4_put_job(
    v_o1, v_org, v_exp, 'infonavit_carta_bajo_protesta', 0
  );
  PERFORM public.__p189_b4_put_job(
    v_o2, v_org, v_exp, 'infonavit_presupuesto_mejoramiento', 0
  );
  PERFORM public.__p189_b4_put_job(
    v_o3, v_org, v_exp, 'infonavit_solicitud_inscripcion', 0
  );

  -- grants
  SELECT has_function_privilege(
    'authenticated', 'public.infonavit_pdf_claim_outbox(uuid,integer)', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b4_assert(NOT v_exec, 'grants: authenticated no claim');
  SELECT has_function_privilege(
    'authenticated', 'public.infonavit_pdf_fail_outbox(uuid,text,boolean,timestamptz)', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b4_assert(NOT v_exec, 'grants: authenticated no fail');
  SELECT has_function_privilege(
    'authenticated', 'public.infonavit_pdf_complete_outbox(uuid,text,text,bigint)', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b4_assert(NOT v_exec, 'grants: authenticated no complete');
  SELECT has_function_privilege(
    'authenticated', 'public.infonavit_pdf_load_claimed_job(uuid)', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b4_assert(NOT v_exec, 'grants: authenticated no load');
  SELECT has_function_privilege(
    'service_role', 'public.infonavit_pdf_claim_outbox(uuid,integer)', 'EXECUTE'
  ) INTO v_exec;
  PERFORM public.__p189_b4_assert(v_exec, 'grants: service_role claim');

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.infonavit_pdf_claim_outbox();
    PERFORM public.__p189_b4_assert(false, 'auth claim debió denegar');
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  WHEN OTHERS THEN
    PERFORM public.__p189_b4_assert(
      SQLSTATE IN ('42501', '42500'),
      'auth claim denied: ' || SQLERRM
    );
  END;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.expediente_infonavit_submission_snapshots LIMIT 1;
    PERFORM public.__p189_b4_assert(false, 'auth snapshot SELECT debió denegar');
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  WHEN OTHERS THEN
    PERFORM public.__p189_b4_assert(
      SQLSTATE IN ('42501', '42500'),
      'auth snapshot denied'
    );
  END;

  -- claim by id
  v_claim := public.infonavit_pdf_claim_outbox(v_o1, 1);
  PERFORM public.__p189_b4_assert(
    jsonb_array_length(v_claim->'claimed') = 1, 'claim: 1 row'
  );
  PERFORM public.__p189_b4_assert(
    v_claim->'claimed'->0->>'outbox_id' = v_o1::text, 'claim: id'
  );
  PERFORM public.__p189_b4_assert(
    (v_claim->'claimed'->0->>'attempts')::int = 1, 'claim: attempts 1'
  );
  PERFORM public.__p189_b4_assert(
    (v_claim->'claimed'->0)->'payload' IS NULL, 'claim: sin payload PII'
  );

  -- second claim same outbox (not stale) → 0
  v_claim := public.infonavit_pdf_claim_outbox(v_o1, 1);
  PERFORM public.__p189_b4_assert(
    jsonb_array_length(v_claim->'claimed') = 0, 'claim duplicate: 0'
  );

  -- load + hash
  v_load := public.infonavit_pdf_load_claimed_job(v_o1);
  PERFORM public.__p189_b4_assert((v_load->>'ok')::boolean, 'load ok');
  PERFORM public.__p189_b4_assert(
    v_load->>'b1_document_type' = 'carta_bajo_protesta', 'load b1 map'
  );

  -- complete path mismatch
  BEGIN
    PERFORM public.infonavit_pdf_complete_outbox(
      v_o1, v_org::text || '/' || v_exp::text || '/infonavit_carta_bajo_protesta/evil.pdf',
      'application/pdf', 100
    );
    PERFORM public.__p189_b4_assert(false, 'path mismatch debió fallar');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p189_b4_assert(SQLERRM LIKE '%INFONAVIT_STORAGE_PATH_INVALID%', 'path reject');
  END;
  SELECT status INTO v_status FROM public.infonavit_pdf_outbox WHERE id = v_o1;
  PERFORM public.__p189_b4_assert(v_status = 'processing', 'path fail: sigue processing');

  -- complete ok
  v_path := public.infonavit_pdf_expected_storage_path(
    v_org, v_exp, 'infonavit_carta_bajo_protesta', v_o1
  );
  PERFORM public.__p189_b4_put_object(v_path);
  v_done := public.infonavit_pdf_complete_outbox(
    v_o1, v_path, 'application/pdf', 2048
  );
  PERFORM public.__p189_b4_assert((v_done->>'ok')::boolean, 'complete ok');
  PERFORM public.__p189_b4_assert((v_done->>'active')::boolean, 'complete active');
  PERFORM public.__p189_b4_assert((v_done->>'version')::int = 1, 'version 1');
  PERFORM public.__p189_b4_assert(
    (SELECT estatus_revision::text FROM public.expediente_documentos
     WHERE id = (v_done->>'documento_id')::uuid) = 'subido',
    'estatus subido'
  );
  PERFORM public.__p189_b4_assert(
    (SELECT uploaded_by_role FROM public.expediente_documentos
     WHERE id = (v_done->>'documento_id')::uuid) = 'sistema',
    'uploaded_by_role sistema'
  );

  -- idempotent complete
  v_done2 := public.infonavit_pdf_complete_outbox(
    v_o1, v_path, 'application/pdf', 2048
  );
  PERFORM public.__p189_b4_assert((v_done2->>'already_done')::boolean, 'already_done');
  SELECT count(*) INTO v_cnt FROM public.expediente_documentos
  WHERE expediente_id = v_exp AND tipo_documento = 'infonavit_carta_bajo_protesta';
  PERFORM public.__p189_b4_assert(v_cnt = 1, 'idempotent: 1 metadata');

  -- retry then terminal
  v_claim := public.infonavit_pdf_claim_outbox(v_o2, 1);
  v_fail := public.infonavit_pdf_fail_outbox(
    v_o2, 'STORAGE_UPLOAD_FAILED', true,
    (v_claim->'claimed'->0->>'processing_started_at')::timestamptz
  );
  PERFORM public.__p189_b4_assert(v_fail->>'status' = 'pending', 'retry pending');
  SELECT available_at, status, attempts, processing_started_at
  INTO v_avail, v_status, v_attempts, v_del
  FROM public.infonavit_pdf_outbox WHERE id = v_o2;
  PERFORM public.__p189_b4_assert(v_status = 'pending', 'retry status');
  PERFORM public.__p189_b4_assert(v_avail > NOW(), 'retry available_at futuro');
  PERFORM public.__p189_b4_assert(v_del IS NULL, 'retry cleared lease');
  PERFORM public.__p189_b4_assert(
    NOT EXISTS (
      SELECT 1 FROM public.expediente_documentos
      WHERE expediente_id = v_exp
        AND tipo_documento = 'infonavit_presupuesto_mejoramiento'
    ),
    'retry: 0 documento'
  );

  -- force available_at now and fail non-retryable
  UPDATE public.infonavit_pdf_outbox SET available_at = NOW() WHERE id = v_o2;
  v_claim := public.infonavit_pdf_claim_outbox(v_o2, 1);
  v_fail := public.infonavit_pdf_fail_outbox(
    v_o2, 'TEMPLATE_CONTRACT_MISMATCH', true,
    (v_claim->'claimed'->0->>'processing_started_at')::timestamptz
  );
  PERFORM public.__p189_b4_assert(v_fail->>'status' = 'failed', 'terminal failed');
  PERFORM public.__p189_b4_assert(v_fail->>'last_error_code' = 'TEMPLATE_CONTRACT_MISMATCH', 'sanitized code');

  -- lease recovery
  v_claim := public.infonavit_pdf_claim_outbox(v_o3, 1);
  PERFORM public.__p189_b4_assert(jsonb_array_length(v_claim->'claimed') = 1, 'lease claim 1');
  UPDATE public.infonavit_pdf_outbox
  SET processing_started_at = NOW() - INTERVAL '11 minutes'
  WHERE id = v_o3;
  v_claim := public.infonavit_pdf_claim_outbox(v_o3, 1);
  PERFORM public.__p189_b4_assert(jsonb_array_length(v_claim->'claimed') = 1, 'lease reclaim');
  PERFORM public.__p189_b4_assert(
    (v_claim->'claimed'->0->>'attempts')::int = 2, 'lease attempts 2'
  );

  -- fail lease lost
  v_fail := public.infonavit_pdf_fail_outbox(
    v_o3, 'STORAGE_UPLOAD_FAILED', true, NOW() - INTERVAL '1 hour'
  );
  PERFORM public.__p189_b4_assert((v_fail->>'lease_lost')::boolean, 'lease_lost');
  SELECT status INTO v_status FROM public.infonavit_pdf_outbox WHERE id = v_o3;
  PERFORM public.__p189_b4_assert(v_status = 'processing', 'lease_lost no muta');

  -- S1 active, S2 fail preserves S1
  PERFORM public.__p189_b4_seed_exp(v_exp2, v_org, v_asesor, '18500000002');
  PERFORM public.__p189_b4_put_job(
    v_s1, v_org, v_exp2, 'infonavit_carta_bajo_protesta', 0,
    jsonb_build_object('schemaVersion', 1, 'mark', 's1')
  );
  v_claim := public.infonavit_pdf_claim_outbox(v_s1, 1);
  v_path := public.infonavit_pdf_expected_storage_path(
    v_org, v_exp2, 'infonavit_carta_bajo_protesta', v_s1
  );
  PERFORM public.__p189_b4_put_object(v_path);
  v_done := public.infonavit_pdf_complete_outbox(v_s1, v_path, 'application/pdf', 100);
  PERFORM public.__p189_b4_assert((v_done->>'active')::boolean, 's1 active');

  PERFORM public.__p189_b4_put_job(
    v_s2, v_org, v_exp2, 'infonavit_carta_bajo_protesta', 1,
    jsonb_build_object('schemaVersion', 1, 'mark', 's2')
  );
  v_claim := public.infonavit_pdf_claim_outbox(v_s2, 1);
  v_fail := public.infonavit_pdf_fail_outbox(
    v_s2, 'PDF_GENERATION_FAILED', false,
    (v_claim->'claimed'->0->>'processing_started_at')::timestamptz
  );
  PERFORM public.__p189_b4_assert(v_fail->>'status' = 'failed', 's2 failed');
  SELECT id, deleted_at INTO v_active, v_del
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp2
    AND tipo_documento = 'infonavit_carta_bajo_protesta'
    AND deleted_at IS NULL;
  PERFORM public.__p189_b4_assert(v_active = (v_done->>'documento_id')::uuid, 's1 sigue activo');
  PERFORM public.__p189_b4_assert(v_del IS NULL, 's1 not soft-deleted');

  -- out-of-order: S2 done first, then S1
  PERFORM public.__p189_b4_seed_exp(v_exp3, v_org, v_asesor, '18500000003');
  PERFORM public.__p189_b4_put_job(
    v_r1, v_org, v_exp3, 'infonavit_presupuesto_mejoramiento', 0,
    jsonb_build_object('schemaVersion', 1, 'mark', 'ooo-s1')
  );
  PERFORM public.__p189_b4_put_job(
    v_t1, v_org, v_exp3, 'infonavit_presupuesto_mejoramiento', 1,
    jsonb_build_object('schemaVersion', 1, 'mark', 'ooo-s2')
  );
  v_path2 := public.infonavit_pdf_expected_storage_path(
    v_org, v_exp3, 'infonavit_presupuesto_mejoramiento', v_t1
  );
  v_path := public.infonavit_pdf_expected_storage_path(
    v_org, v_exp3, 'infonavit_presupuesto_mejoramiento', v_r1
  );
  PERFORM public.__p189_b4_put_object(v_path2);
  PERFORM public.__p189_b4_put_object(v_path);
  PERFORM public.infonavit_pdf_claim_outbox(v_t1, 1);
  v_done := public.infonavit_pdf_complete_outbox(v_t1, v_path2, 'application/pdf', 111);
  PERFORM public.__p189_b4_assert((v_done->>'active')::boolean, 'ooo S2 active');
  PERFORM public.infonavit_pdf_claim_outbox(v_r1, 1);
  v_done2 := public.infonavit_pdf_complete_outbox(v_r1, v_path, 'application/pdf', 110);
  PERFORM public.__p189_b4_assert((v_done2->>'active')::boolean = false, 'ooo S1 histórico');
  SELECT id INTO v_active
  FROM public.expediente_documentos
  WHERE expediente_id = v_exp3
    AND tipo_documento = 'infonavit_presupuesto_mejoramiento'
    AND deleted_at IS NULL;
  PERFORM public.__p189_b4_assert(v_active = (v_done->>'documento_id')::uuid, 'ooo active sigue S2');
  PERFORM public.__p189_b4_assert(
    (SELECT deleted_at IS NOT NULL FROM public.expediente_documentos
     WHERE id = (v_done2->>'documento_id')::uuid),
    'ooo S1 metadata inactiva'
  );
  PERFORM public.__p189_b4_assert(
    (SELECT count(*) FROM storage.objects
     WHERE bucket_id = 'expediente-documentos' AND name IN (v_path, v_path2)) = 2,
    'ooo ambos objetos permanecen'
  );

  -- versioning: S1 then S2 success increments and soft-deletes
  PERFORM public.__p189_b4_seed_exp(v_exp4, v_org, v_asesor, '18500000004');
  PERFORM public.__p189_b4_put_job(
    '00000000-0000-4000-9185-00000000ee01'::uuid,
    v_org, v_exp4, 'infonavit_solicitud_inscripcion', 0
  );
  PERFORM public.__p189_b4_put_job(
    '00000000-0000-4000-9185-00000000ee02'::uuid,
    v_org, v_exp4, 'infonavit_solicitud_inscripcion', 1
  );
  v_path := public.infonavit_pdf_expected_storage_path(
    v_org, v_exp4, 'infonavit_solicitud_inscripcion',
    '00000000-0000-4000-9185-00000000ee01'::uuid
  );
  v_path2 := public.infonavit_pdf_expected_storage_path(
    v_org, v_exp4, 'infonavit_solicitud_inscripcion',
    '00000000-0000-4000-9185-00000000ee02'::uuid
  );
  PERFORM public.__p189_b4_put_object(v_path);
  PERFORM public.__p189_b4_put_object(v_path2);
  PERFORM public.infonavit_pdf_claim_outbox('00000000-0000-4000-9185-00000000ee01'::uuid, 1);
  v_done := public.infonavit_pdf_complete_outbox(
    '00000000-0000-4000-9185-00000000ee01'::uuid, v_path, 'application/pdf', 50
  );
  PERFORM public.infonavit_pdf_claim_outbox('00000000-0000-4000-9185-00000000ee02'::uuid, 1);
  v_done2 := public.infonavit_pdf_complete_outbox(
    '00000000-0000-4000-9185-00000000ee02'::uuid, v_path2, 'application/pdf', 60
  );
  PERFORM public.__p189_b4_assert((v_done2->>'version')::int = 2, 'version 2');
  PERFORM public.__p189_b4_assert((v_done2->>'active')::boolean, 's2 replaces');
  PERFORM public.__p189_b4_assert(
    (SELECT deleted_at IS NOT NULL FROM public.expediente_documentos
     WHERE id = (v_done->>'documento_id')::uuid),
    's1 soft-deleted after s2 success'
  );

  -- upload ok / complete fail (size 0) → retry same path → 1 metadata
  PERFORM public.__p189_b4_seed_exp(v_exp5, v_org, v_asesor, '18500000005');
  PERFORM public.__p189_b4_put_job(
    '00000000-0000-4000-9185-00000000ff01'::uuid,
    v_org, v_exp5, 'infonavit_carta_bajo_protesta', 0
  );
  v_path := public.infonavit_pdf_expected_storage_path(
    v_org, v_exp5, 'infonavit_carta_bajo_protesta',
    '00000000-0000-4000-9185-00000000ff01'::uuid
  );
  PERFORM public.__p189_b4_put_object(v_path);
  PERFORM public.infonavit_pdf_claim_outbox('00000000-0000-4000-9185-00000000ff01'::uuid, 1);
  BEGIN
    PERFORM public.infonavit_pdf_complete_outbox(
      '00000000-0000-4000-9185-00000000ff01'::uuid, v_path, 'application/pdf', 0
    );
    PERFORM public.__p189_b4_assert(false, 'size 0 debió fallar');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p189_b4_assert(SQLERRM LIKE '%DOCUMENT_REGISTER_FAILED%', 'complete fail size');
  END;
  SELECT count(*) INTO v_cnt FROM storage.objects
  WHERE bucket_id = 'expediente-documentos' AND name = v_path;
  PERFORM public.__p189_b4_assert(v_cnt = 1, 'same path 1 object');
  SELECT status INTO v_status FROM public.infonavit_pdf_outbox
  WHERE id = '00000000-0000-4000-9185-00000000ff01'::uuid;
  PERFORM public.__p189_b4_assert(v_status = 'processing', 'complete fail keeps processing');
  v_fail := public.infonavit_pdf_fail_outbox(
    '00000000-0000-4000-9185-00000000ff01'::uuid,
    'DOCUMENT_REGISTER_FAILED', true, NULL
  );
  PERFORM public.__p189_b4_assert(v_fail->>'status' = 'pending', 'after complete-fail → pending');
  UPDATE public.infonavit_pdf_outbox
  SET available_at = NOW()
  WHERE id = '00000000-0000-4000-9185-00000000ff01'::uuid;
  PERFORM public.infonavit_pdf_claim_outbox('00000000-0000-4000-9185-00000000ff01'::uuid, 1);
  v_done := public.infonavit_pdf_complete_outbox(
    '00000000-0000-4000-9185-00000000ff01'::uuid, v_path, 'application/pdf', 80
  );
  PERFORM public.__p189_b4_assert((v_done->>'ok')::boolean, 'retry complete ok');
  SELECT count(*) INTO v_cnt FROM public.expediente_documentos
  WHERE expediente_id = v_exp5 AND tipo_documento = 'infonavit_carta_bajo_protesta';
  PERFORM public.__p189_b4_assert(v_cnt = 1, 'retry: 1 metadata');
  SELECT count(*) INTO v_cnt FROM storage.objects
  WHERE bucket_id = 'expediente-documentos' AND name = v_path;
  PERFORM public.__p189_b4_assert(v_cnt = 1, 'retry: 1 object');

  -- sanitize unknown error
  PERFORM public.__p189_b4_assert(
    public.infonavit_pdf_sanitize_error_code('boom stacktrace NSS') = 'PDF_GENERATION_FAILED',
    'sanitize unknown'
  );

  RAISE NOTICE 'P189 B4 SQL: PASSED';
  PERFORM public.__p189_clear_feature_vault();
END;
$$;
