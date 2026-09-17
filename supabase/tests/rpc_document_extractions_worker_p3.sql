-- ConCasa CRM — P3 document_extractions worker claim/lease/complete
-- LOCAL. NO Cloud. Fixtures sintéticos. BEGIN/ROLLBACK hygiene.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.__p3_dx_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P3 DX TEST FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org UUID;
  v_asesor UUID;
  v_exp UUID := 'a3d00000-0000-4000-8000-000000000001';
  v_doc_v1 UUID := 'a3d00000-0000-4000-8000-000000000011';
  v_doc_v2 UUID := 'a3d00000-0000-4000-8000-000000000012';
  v_doc_b UUID := 'a3d00000-0000-4000-8000-000000000013';
  v_r JSONB;
  v_claim JSONB;
  v_claim2 JSONB;
  v_job_id UUID;
  v_job_id_b UUID;
  v_ext_id UUID;
  v_claimed_at TIMESTAMPTZ;
  v_attempts INTEGER;
  v_status TEXT;
  v_cnt INTEGER;
  v_has_priv BOOLEAN;
  v_lease1 TIMESTAMPTZ;
  v_lease2 TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_org FROM public.organizations LIMIT 1;
  PERFORM public.__p3_dx_assert(v_org IS NOT NULL, 'org');

  SELECT id INTO v_asesor
  FROM public.profiles
  WHERE organization_id = v_org AND app_role = 'asesor'
  LIMIT 1;
  PERFORM public.__p3_dx_assert(v_asesor IS NOT NULL, 'asesor');

  -- Flags DEFAULT OFF
  PERFORM public.__p3_dx_assert(
    public.document_extraction_feature_enabled() IS FALSE,
    'enqueue flag OFF'
  );
  PERFORM public.__p3_dx_assert(
    public.document_extraction_worker_enabled() IS FALSE,
    'worker flag OFF'
  );

  -- Privileges: anon/authenticated no claim
  SELECT has_function_privilege(
    'authenticated',
    'public.document_extraction_claim_jobs(integer)',
    'EXECUTE'
  ) INTO v_has_priv;
  PERFORM public.__p3_dx_assert(v_has_priv IS FALSE, 'auth no claim');

  SELECT has_function_privilege(
    'anon',
    'public.document_extraction_claim_jobs(integer)',
    'EXECUTE'
  ) INTO v_has_priv;
  PERFORM public.__p3_dx_assert(v_has_priv IS FALSE, 'anon no claim');

  SELECT has_table_privilege('authenticated', 'public.document_extractions', 'SELECT')
    INTO v_has_priv;
  PERFORM public.__p3_dx_assert(v_has_priv IS FALSE, 'auth no SELECT payload');

  -- Override flags ON (rollback lo deshace)
  CREATE OR REPLACE FUNCTION public.document_extraction_feature_enabled()
  RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $f$ SELECT true $f$;

  CREATE OR REPLACE FUNCTION public.document_extraction_worker_enabled()
  RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $f$ SELECT true $f$;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '33990011001',
    'Fixture P3 DX', '5500000003', 'interno', false,
    1, 'pendiente', 'activo'
  );

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES
    (v_doc_v1, v_org, v_exp, 'cliente_ine_frente',
     'synthetic/p3/ine_v1.pdf', 'ine_v1.pdf', 'application/pdf', 100, 1,
     v_asesor, 'asesor'),
    (v_doc_b, v_org, v_exp, 'cliente_comprobante_domicilio',
     'synthetic/p3/cfe.pdf', 'cfe.pdf', 'application/pdf', 100, 1,
     v_asesor, 'asesor');

  -- Enqueue 2 jobs (FIFO by available_at)
  v_r := public.enqueue_document_extraction(v_doc_v1, 'shadow', 'p3');
  PERFORM public.__p3_dx_assert((v_r->>'enqueued')::boolean, 'enqueue v1');
  PERFORM pg_sleep(0.05);
  v_r := public.enqueue_document_extraction(v_doc_b, 'shadow', 'p3');
  PERFORM public.__p3_dx_assert((v_r->>'enqueued')::boolean, 'enqueue B');

  -- 1) claim FIFO limit 1
  v_claim := public.document_extraction_claim_jobs(1);
  PERFORM public.__p3_dx_assert(
    jsonb_array_length(v_claim->'claimed') = 1,
    'claim 1 job'
  );
  v_job_id := (v_claim->'claimed'->0->>'job_id')::UUID;
  v_claimed_at := (v_claim->'claimed'->0->>'claimed_at')::TIMESTAMPTZ;
  v_attempts := (v_claim->'claimed'->0->>'attempts')::INT;
  PERFORM public.__p3_dx_assert(v_attempts = 1, 'attempts=1');
  PERFORM public.__p3_dx_assert(
    (v_claim->'claimed'->0->>'documento_id')::UUID = v_doc_v1,
    'FIFO ine primero'
  );
  v_lease1 := (v_claim->'claimed'->0->>'lease_expires_at')::TIMESTAMPTZ;
  PERFORM public.__p3_dx_assert(v_lease1 > NOW(), 'lease asignado');

  -- 6) job con lease vigente no se duplica
  v_claim2 := public.document_extraction_claim_jobs(5);
  PERFORM public.__p3_dx_assert(
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_claim2->'claimed') x
      WHERE (x->>'job_id')::UUID = v_job_id
    ),
    'no reclaim lease vigente'
  );
  -- claim remaining B
  PERFORM public.__p3_dx_assert(
    jsonb_array_length(v_claim2->'claimed') = 1,
    'claim B restante'
  );
  v_job_id_b := (v_claim2->'claimed'->0->>'job_id')::UUID;

  -- 7) success atómico
  v_r := public.document_extraction_complete_job(
    v_job_id,
    '{"fields":{}}'::JSONB,
    NULL,
    v_claimed_at
  );
  PERFORM public.__p3_dx_assert((v_r->>'ok')::boolean, 'complete ok');
  SELECT status INTO v_status FROM public.document_extraction_jobs WHERE id = v_job_id;
  PERFORM public.__p3_dx_assert(v_status = 'done', 'job done');
  SELECT e.status INTO v_status
  FROM public.document_extractions e
  JOIN public.document_extraction_jobs j ON j.extraction_id = e.id
  WHERE j.id = v_job_id;
  PERFORM public.__p3_dx_assert(v_status = 'done', 'extraction done');

  -- Complete B also
  v_claimed_at := (v_claim2->'claimed'->0->>'claimed_at')::TIMESTAMPTZ;
  v_r := public.document_extraction_complete_job(
    v_job_id_b, '{"fields":{}}'::JSONB, NULL, v_claimed_at
  );
  PERFORM public.__p3_dx_assert((v_r->>'ok')::boolean, 'complete B');

  -- 8/9) failed → retry → dead
  -- new doc version for fail path: soft-delete v1 already done? v1 still active.
  -- Use new enqueue with different provider_version on same active doc → unique ok
  v_r := public.enqueue_document_extraction(v_doc_v1, 'shadow', 'p3-retry');
  PERFORM public.__p3_dx_assert((v_r->>'enqueued')::boolean, 'enqueue retry');
  -- set max_attempts=2 for this job
  UPDATE public.document_extraction_jobs
  SET max_attempts = 2
  WHERE documento_id = v_doc_v1 AND provider_version = 'p3-retry';

  v_claim := public.document_extraction_claim_jobs(1);
  v_job_id := (v_claim->'claimed'->0->>'job_id')::UUID;
  v_claimed_at := (v_claim->'claimed'->0->>'claimed_at')::TIMESTAMPTZ;
  v_r := public.document_extraction_mark_failed(
    v_job_id, 'provider_failed', true, v_claimed_at
  );
  PERFORM public.__p3_dx_assert(v_r->>'status' = 'failed', 'failed retryable');
  SELECT available_at > NOW(), attempts INTO v_has_priv, v_attempts
  FROM public.document_extraction_jobs WHERE id = v_job_id;
  -- available_at in future; force available now for reclaim
  UPDATE public.document_extraction_jobs
  SET available_at = NOW() - INTERVAL '1 second'
  WHERE id = v_job_id;

  v_claim := public.document_extraction_claim_jobs(1);
  PERFORM public.__p3_dx_assert(
    (v_claim->'claimed'->0->>'job_id')::UUID = v_job_id,
    'reclaim failed'
  );
  v_attempts := (v_claim->'claimed'->0->>'attempts')::INT;
  PERFORM public.__p3_dx_assert(v_attempts = 2, 'attempts=2');
  v_claimed_at := (v_claim->'claimed'->0->>'claimed_at')::TIMESTAMPTZ;

  v_r := public.document_extraction_mark_failed(
    v_job_id, 'provider_failed', true, v_claimed_at
  );
  PERFORM public.__p3_dx_assert(v_r->>'status' = 'dead', 'max_attempts → dead');

  -- 5) lease vencido reclaim
  v_r := public.enqueue_document_extraction(v_doc_v1, 'shadow', 'p3-lease');
  PERFORM public.__p3_dx_assert((v_r->>'enqueued')::boolean, 'enqueue lease');
  v_claim := public.document_extraction_claim_jobs(1);
  v_job_id := (v_claim->'claimed'->0->>'job_id')::UUID;
  UPDATE public.document_extraction_jobs
  SET lease_expires_at = NOW() - INTERVAL '1 second'
  WHERE id = v_job_id;
  v_claim2 := public.document_extraction_claim_jobs(1);
  PERFORM public.__p3_dx_assert(
    (v_claim2->'claimed'->0->>'job_id')::UUID = v_job_id,
    'reclaim lease vencido'
  );
  v_attempts := (v_claim2->'claimed'->0->>'attempts')::INT;
  PERFORM public.__p3_dx_assert(v_attempts >= 2, 'attempts incrementa en reclaim');

  -- 10/11) v1 claimed + v2 → stale; complete no revive
  -- Finish current lease job first as stale path on v1 ine:
  -- soft-delete v1, insert v2, mark stale via complete check
  -- Use a fresh enqueue for race:
  -- Cancel/finish lease job as failed non-retry to clear
  v_claimed_at := (v_claim2->'claimed'->0->>'claimed_at')::TIMESTAMPTZ;
  PERFORM public.document_extraction_mark_failed(
    v_job_id, 'internal_error', false, v_claimed_at
  );

  v_r := public.enqueue_document_extraction(v_doc_v1, 'shadow', 'p3-stale');
  PERFORM public.__p3_dx_assert((v_r->>'enqueued')::boolean, 'enqueue stale race');
  v_claim := public.document_extraction_claim_jobs(1);
  v_job_id := (v_claim->'claimed'->0->>'job_id')::UUID;
  v_claimed_at := (v_claim->'claimed'->0->>'claimed_at')::TIMESTAMPTZ;
  v_ext_id := (v_claim->'claimed'->0->>'extraction_id')::UUID;

  UPDATE public.expediente_documentos
  SET deleted_at = NOW(), updated_at = NOW()
  WHERE id = v_doc_v1;

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, uploaded_by, uploaded_by_role
  ) VALUES (
    v_doc_v2, v_org, v_exp, 'cliente_ine_frente',
    'synthetic/p3/ine_v2.pdf', 'ine_v2.pdf', 'application/pdf', 100, 2,
    v_asesor, 'asesor'
  );

  -- complete v1 while not current → stale
  v_r := public.document_extraction_complete_job(
    v_job_id, '{"fields":{}}'::JSONB, NULL, v_claimed_at
  );
  PERFORM public.__p3_dx_assert(
    v_r->>'status' = 'stale' OR v_r->>'error_code' = 'document_not_current',
    'complete v1 → stale'
  );
  SELECT status INTO v_status FROM public.document_extraction_jobs WHERE id = v_job_id;
  PERFORM public.__p3_dx_assert(v_status = 'stale', 'job v1 stale');
  SELECT status INTO v_status FROM public.document_extractions WHERE id = v_ext_id;
  PERFORM public.__p3_dx_assert(v_status = 'stale', 'extraction v1 stale');

  -- 11) complete stale NO revive
  v_r := public.document_extraction_complete_job(
    v_job_id, '{"fields":{}}'::JSONB, NULL, v_claimed_at
  );
  PERFORM public.__p3_dx_assert(
    (v_r->>'ok')::boolean IS FALSE
    AND COALESCE((v_r->>'revived')::boolean, false) IS FALSE,
    'no revive stale'
  );
  SELECT status INTO v_status FROM public.document_extraction_jobs WHERE id = v_job_id;
  PERFORM public.__p3_dx_assert(v_status = 'stale', 'sigue stale');

  -- 12) unsupported provider: enqueue then claim+fail path via mark
  -- Direct insert extraction+job with provider openai (align triggers)
  INSERT INTO public.document_extractions (
    organization_id, expediente_id, documento_id, document_version,
    document_type, provider, provider_version, status
  ) VALUES (
    v_org, v_exp, v_doc_v2, 2,
    'cliente_ine_frente', 'openai', 'x', 'pending'
  ) RETURNING id INTO v_ext_id;

  INSERT INTO public.document_extraction_jobs (
    extraction_id, organization_id, expediente_id, documento_id,
    document_version, document_type, provider, provider_version, status
  ) VALUES (
    v_ext_id, v_org, v_exp, v_doc_v2, 2,
    'cliente_ine_frente', 'openai', 'x', 'pending'
  ) RETURNING id INTO v_job_id;

  v_claim := public.document_extraction_claim_jobs(1);
  PERFORM public.__p3_dx_assert(
    (v_claim->'claimed'->0->>'provider') = 'openai',
    'claim openai job'
  );
  -- Worker would mark unsupported; simulate RPC fail non-retryable
  v_claimed_at := (v_claim->'claimed'->0->>'claimed_at')::TIMESTAMPTZ;
  v_r := public.document_extraction_mark_failed(
    (v_claim->'claimed'->0->>'job_id')::UUID,
    'unsupported_provider',
    false,
    v_claimed_at
  );
  PERFORM public.__p3_dx_assert(v_r->>'status' = 'dead', 'unsupported → dead');

  -- load_job_meta sin payload_raw
  v_r := public.document_extraction_load_job_meta(
    (SELECT id FROM public.document_extraction_jobs WHERE documento_id = v_doc_v2 AND provider = 'openai' LIMIT 1)
  );
  PERFORM public.__p3_dx_assert(
    v_r ? 'storage_path' AND NOT (v_r ? 'payload_raw'),
    'meta sin payload_raw'
  );

  RAISE NOTICE 'P3 DX tests PASS';
END;
$$;

ROLLBACK;
