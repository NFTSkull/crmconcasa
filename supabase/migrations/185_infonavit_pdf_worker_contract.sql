-- ConCasa CRM — P189 B4: worker PDF contract (claim / fail / complete)
-- LOCAL ONLY. NO cron. NO pg_net. NO Vault. NO Edge invocation.
-- NO muta 183. NO altera semántica 184 (snapshot/enqueue intactos).

-- =============================================================================
-- A) Índices de claim / lease
-- =============================================================================

CREATE INDEX IF NOT EXISTS infonavit_pdf_outbox_lease_idx
  ON public.infonavit_pdf_outbox (processing_started_at)
  WHERE status = 'processing';

-- =============================================================================
-- B) Helpers (path / display / mapping / errors / lease)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.infonavit_pdf_worker_lease_interval()
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT INTERVAL '10 minutes';
$$;

COMMENT ON FUNCTION public.infonavit_pdf_worker_lease_interval() IS
  'P189 B4: lease de processing. Sin cron; reclaim en el siguiente claim.';

CREATE OR REPLACE FUNCTION public.infonavit_pdf_b1_document_type(p_document_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_document_type
    WHEN 'infonavit_carta_bajo_protesta' THEN 'carta_bajo_protesta'
    WHEN 'infonavit_presupuesto_mejoramiento' THEN 'presupuesto_mejoramiento'
    WHEN 'infonavit_solicitud_inscripcion' THEN 'solicitud_inscripcion_credito'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_display_filename(p_document_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_document_type
    WHEN 'infonavit_carta_bajo_protesta' THEN 'Carta Bajo Protesta.pdf'
    WHEN 'infonavit_presupuesto_mejoramiento' THEN 'Presupuesto de Mejoramiento.pdf'
    WHEN 'infonavit_solicitud_inscripcion' THEN 'Solicitud de Inscripción de Crédito.pdf'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_expected_storage_path(
  p_organization_id UUID,
  p_expediente_id UUID,
  p_document_type TEXT,
  p_outbox_id UUID
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_organization_id::TEXT
    || '/' || p_expediente_id::TEXT
    || '/' || p_document_type
    || '/' || p_outbox_id::TEXT
    || '.pdf';
$$;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_sanitize_error_code(p_error_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE btrim(upper(COALESCE(p_error_code, '')))
    WHEN 'AUTH_FAILED' THEN 'AUTH_FAILED'
    WHEN 'OUTBOX_NOT_FOUND' THEN 'OUTBOX_NOT_FOUND'
    WHEN 'SNAPSHOT_NOT_FOUND' THEN 'SNAPSHOT_NOT_FOUND'
    WHEN 'SNAPSHOT_CONTRACT_INVALID' THEN 'SNAPSHOT_CONTRACT_INVALID'
    WHEN 'SNAPSHOT_HASH_MISMATCH' THEN 'SNAPSHOT_HASH_MISMATCH'
    WHEN 'TEMPLATE_CONTRACT_MISMATCH' THEN 'TEMPLATE_CONTRACT_MISMATCH'
    WHEN 'PDF_GENERATION_FAILED' THEN 'PDF_GENERATION_FAILED'
    WHEN 'PDF_VALIDATION_FAILED' THEN 'PDF_VALIDATION_FAILED'
    WHEN 'STORAGE_UPLOAD_FAILED' THEN 'STORAGE_UPLOAD_FAILED'
    WHEN 'DOCUMENT_REGISTER_FAILED' THEN 'DOCUMENT_REGISTER_FAILED'
    ELSE 'PDF_GENERATION_FAILED'
  END;
$$;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_error_is_non_retryable(p_error_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.infonavit_pdf_sanitize_error_code(p_error_code) IN (
    'AUTH_FAILED',
    'OUTBOX_NOT_FOUND',
    'SNAPSHOT_NOT_FOUND',
    'SNAPSHOT_CONTRACT_INVALID',
    'SNAPSHOT_HASH_MISMATCH',
    'TEMPLATE_CONTRACT_MISMATCH',
    'PDF_VALIDATION_FAILED'
  );
$$;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_retry_backoff(p_attempts INTEGER)
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_attempts, 0) <= 1 THEN INTERVAL '1 minute'
    WHEN p_attempts = 2 THEN INTERVAL '5 minutes'
    WHEN p_attempts = 3 THEN INTERVAL '15 minutes'
    ELSE INTERVAL '30 minutes'
  END;
$$;

CREATE OR REPLACE FUNCTION public.infonavit_pdf_payload_sha256(p_payload JSONB)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT encode(
    extensions.digest(convert_to(p_payload::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

REVOKE ALL ON FUNCTION public.infonavit_pdf_worker_lease_interval() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_b1_document_type(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_display_filename(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_expected_storage_path(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_sanitize_error_code(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_error_is_non_retryable(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_retry_backoff(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_payload_sha256(JSONB) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.infonavit_pdf_worker_lease_interval() TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_b1_document_type(TEXT) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_display_filename(TEXT) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_expected_storage_path(UUID, UUID, TEXT, UUID) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_sanitize_error_code(TEXT) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_error_is_non_retryable(TEXT) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_retry_backoff(INTEGER) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_payload_sha256(JSONB) TO postgres, service_role;

-- =============================================================================
-- C) CLAIM — SKIP LOCKED + lease stale. Sin PII.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.infonavit_pdf_claim_outbox(
  p_outbox_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_claimed JSONB := '[]'::JSONB;
BEGIN
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 3), 10));
  IF p_outbox_id IS NOT NULL THEN
    v_limit := 1;
  END IF;

  WITH candidates AS (
    SELECT o.id
    FROM public.infonavit_pdf_outbox o
    WHERE (p_outbox_id IS NULL OR o.id = p_outbox_id)
      AND (
        (o.status = 'pending' AND o.available_at <= NOW())
        OR (
          o.status = 'processing'
          AND o.processing_started_at IS NOT NULL
          AND o.processing_started_at < NOW() - public.infonavit_pdf_worker_lease_interval()
        )
      )
    ORDER BY o.available_at ASC, o.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.infonavit_pdf_outbox o
    SET
      status = 'processing',
      attempts = o.attempts + 1,
      processing_started_at = NOW(),
      updated_at = NOW()
    FROM candidates c
    WHERE o.id = c.id
    RETURNING
      o.id,
      o.snapshot_id,
      o.expediente_id,
      o.organization_id,
      o.document_type,
      o.submission_version,
      o.template_version,
      o.template_sha256,
      o.snapshot_hash,
      o.attempts,
      o.max_attempts,
      o.processing_started_at
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'outbox_id', u.id,
        'snapshot_id', u.snapshot_id,
        'expediente_id', u.expediente_id,
        'organization_id', u.organization_id,
        'document_type', u.document_type,
        'submission_version', u.submission_version,
        'template_version', u.template_version,
        'template_sha256', u.template_sha256,
        'snapshot_hash', u.snapshot_hash,
        'attempts', u.attempts,
        'max_attempts', u.max_attempts,
        'processing_started_at', u.processing_started_at
      )
      ORDER BY u.processing_started_at
    ),
    '[]'::JSONB
  )
  INTO v_claimed
  FROM updated u;

  RETURN jsonb_build_object(
    'ok', true,
    'claimed', COALESCE(v_claimed, '[]'::JSONB)
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_pdf_claim_outbox(UUID, INTEGER) IS
  'P189 B4: claim pending o lease stale. FOR UPDATE SKIP LOCKED. Sin payload PII. Solo service_role.';

-- =============================================================================
-- D) LOAD claimed job (payload solo service_role) + hash server-side
-- =============================================================================

CREATE OR REPLACE FUNCTION public.infonavit_pdf_load_claimed_job(p_outbox_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_out public.infonavit_pdf_outbox%ROWTYPE;
  v_snap public.expediente_infonavit_submission_snapshots%ROWTYPE;
  v_hash TEXT;
  v_expected_sha TEXT;
  v_b1 TEXT;
BEGIN
  IF p_outbox_id IS NULL THEN
    RAISE EXCEPTION 'OUTBOX_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_out
  FROM public.infonavit_pdf_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OUTBOX_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_out.status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'OUTBOX_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_snap
  FROM public.expediente_infonavit_submission_snapshots
  WHERE id = v_out.snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_snap.expediente_id IS DISTINCT FROM v_out.expediente_id
     OR v_snap.organization_id IS DISTINCT FROM v_out.organization_id
     OR v_snap.submission_version IS DISTINCT FROM v_out.submission_version THEN
    RAISE EXCEPTION 'SNAPSHOT_CONTRACT_INVALID' USING ERRCODE = '22023';
  END IF;

  v_hash := public.infonavit_pdf_payload_sha256(v_snap.payload);
  IF v_hash IS DISTINCT FROM v_snap.snapshot_hash
     OR v_hash IS DISTINCT FROM v_out.snapshot_hash THEN
    RAISE EXCEPTION 'SNAPSHOT_HASH_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF v_out.template_version IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION 'TEMPLATE_CONTRACT_MISMATCH' USING ERRCODE = '22023';
  END IF;

  v_expected_sha := public.infonavit_pdf_template_sha256(v_out.document_type);
  IF v_expected_sha IS NULL OR v_out.template_sha256 IS DISTINCT FROM v_expected_sha THEN
    RAISE EXCEPTION 'TEMPLATE_CONTRACT_MISMATCH' USING ERRCODE = '22023';
  END IF;

  v_b1 := public.infonavit_pdf_b1_document_type(v_out.document_type);
  IF v_b1 IS NULL THEN
    RAISE EXCEPTION 'SNAPSHOT_CONTRACT_INVALID' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'outbox_id', v_out.id,
    'snapshot_id', v_out.snapshot_id,
    'expediente_id', v_out.expediente_id,
    'organization_id', v_out.organization_id,
    'document_type', v_out.document_type,
    'b1_document_type', v_b1,
    'submission_version', v_out.submission_version,
    'template_version', v_out.template_version,
    'template_sha256', v_out.template_sha256,
    'snapshot_hash', v_out.snapshot_hash,
    'attempts', v_out.attempts,
    'max_attempts', v_out.max_attempts,
    'processing_started_at', v_out.processing_started_at,
    'expected_storage_path', public.infonavit_pdf_expected_storage_path(
      v_out.organization_id,
      v_out.expediente_id,
      v_out.document_type,
      v_out.id
    ),
    'display_filename', public.infonavit_pdf_display_filename(v_out.document_type),
    'payload', v_snap.payload
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_pdf_load_claimed_job(UUID) IS
  'P189 B4: carga payload del job processing. Hash SHA256 vía JSONB::text (mismo que B3). Solo service_role.';

-- =============================================================================
-- E) FAIL / retry
-- =============================================================================

CREATE OR REPLACE FUNCTION public.infonavit_pdf_fail_outbox(
  p_outbox_id UUID,
  p_error_code TEXT,
  p_retryable BOOLEAN,
  p_lease_started_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out public.infonavit_pdf_outbox%ROWTYPE;
  v_code TEXT;
  v_retry BOOLEAN;
  v_backoff INTERVAL;
BEGIN
  IF p_outbox_id IS NULL THEN
    RAISE EXCEPTION 'OUTBOX_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_out
  FROM public.infonavit_pdf_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OUTBOX_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_out.status = 'done' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_done', true,
      'outbox_id', v_out.id,
      'status', v_out.status
    );
  END IF;

  IF v_out.status = 'failed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_failed', true,
      'outbox_id', v_out.id,
      'status', v_out.status,
      'last_error_code', v_out.last_error_code
    );
  END IF;

  IF v_out.status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'OUTBOX_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF p_lease_started_at IS NOT NULL
     AND v_out.processing_started_at IS DISTINCT FROM p_lease_started_at THEN
    RETURN jsonb_build_object(
      'ok', false,
      'lease_lost', true,
      'outbox_id', v_out.id
    );
  END IF;

  v_code := public.infonavit_pdf_sanitize_error_code(p_error_code);
  v_retry := COALESCE(p_retryable, false)
    AND NOT public.infonavit_pdf_error_is_non_retryable(v_code)
    AND v_out.attempts < v_out.max_attempts;

  IF v_retry THEN
    v_backoff := public.infonavit_pdf_retry_backoff(v_out.attempts);
    UPDATE public.infonavit_pdf_outbox
    SET
      status = 'pending',
      available_at = NOW() + v_backoff,
      processing_started_at = NULL,
      last_error_code = v_code,
      updated_at = NOW()
    WHERE id = p_outbox_id;

    RETURN jsonb_build_object(
      'ok', true,
      'outbox_id', p_outbox_id,
      'status', 'pending',
      'retryable', true,
      'last_error_code', v_code,
      'attempts', v_out.attempts,
      'max_attempts', v_out.max_attempts
    );
  END IF;

  UPDATE public.infonavit_pdf_outbox
  SET
    status = 'failed',
    processed_at = NOW(),
    processing_started_at = NULL,
    last_error_code = v_code,
    updated_at = NOW()
  WHERE id = p_outbox_id;

  RETURN jsonb_build_object(
    'ok', true,
    'outbox_id', p_outbox_id,
    'status', 'failed',
    'retryable', false,
    'last_error_code', v_code,
    'attempts', v_out.attempts,
    'max_attempts', v_out.max_attempts
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_pdf_fail_outbox(UUID, TEXT, BOOLEAN, TIMESTAMPTZ) IS
  'P189 B4: retry pending+backoff o failed terminal. Código sanitizado. Lease token evita fail de worker stale.';

-- =============================================================================
-- F) COMPLETE / register documental atómico + out-of-order
-- =============================================================================

CREATE OR REPLACE FUNCTION public.infonavit_pdf_complete_outbox(
  p_outbox_id UUID,
  p_storage_path TEXT,
  p_mime_type TEXT,
  p_size_bytes BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out public.infonavit_pdf_outbox%ROWTYPE;
  v_snap public.expediente_infonavit_submission_snapshots%ROWTYPE;
  v_exp RECORD;
  v_expected_path TEXT;
  v_display TEXT;
  v_hash TEXT;
  v_newer_exists BOOLEAN;
  v_active BOOLEAN;
  v_prev_id UUID;
  v_new_version INTEGER;
  v_new_id UUID;
  v_mime TEXT;
BEGIN
  IF p_outbox_id IS NULL THEN
    RAISE EXCEPTION 'OUTBOX_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_out
  FROM public.infonavit_pdf_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OUTBOX_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_out.status = 'done' AND v_out.documento_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_done', true,
      'outbox_id', v_out.id,
      'documento_id', v_out.documento_id,
      'submission_version', v_out.submission_version,
      'document_type', v_out.document_type
    );
  END IF;

  IF v_out.status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION 'OUTBOX_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'infonavit_pdf:' || v_out.expediente_id::TEXT || ':' || v_out.document_type,
      0
    )
  );

  SELECT * INTO v_snap
  FROM public.expediente_infonavit_submission_snapshots
  WHERE id = v_out.snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SNAPSHOT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_snap.expediente_id IS DISTINCT FROM v_out.expediente_id
     OR v_snap.organization_id IS DISTINCT FROM v_out.organization_id
     OR v_snap.submission_version IS DISTINCT FROM v_out.submission_version THEN
    RAISE EXCEPTION 'SNAPSHOT_CONTRACT_INVALID' USING ERRCODE = '22023';
  END IF;

  v_hash := public.infonavit_pdf_payload_sha256(v_snap.payload);
  IF v_hash IS DISTINCT FROM v_snap.snapshot_hash
     OR v_hash IS DISTINCT FROM v_out.snapshot_hash THEN
    RAISE EXCEPTION 'SNAPSHOT_HASH_MISMATCH' USING ERRCODE = '22023';
  END IF;

  IF public.infonavit_pdf_b1_document_type(v_out.document_type) IS NULL THEN
    RAISE EXCEPTION 'SNAPSHOT_CONTRACT_INVALID' USING ERRCODE = '22023';
  END IF;

  v_expected_path := public.infonavit_pdf_expected_storage_path(
    v_out.organization_id,
    v_out.expediente_id,
    v_out.document_type,
    v_out.id
  );
  IF btrim(COALESCE(p_storage_path, '')) IS DISTINCT FROM v_expected_path THEN
    RAISE EXCEPTION 'INFONAVIT_STORAGE_PATH_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT public.expediente_documento_storage_path_valid(
    v_expected_path,
    v_out.organization_id,
    v_out.expediente_id,
    v_out.document_type
  ) THEN
    RAISE EXCEPTION 'INFONAVIT_STORAGE_PATH_INVALID' USING ERRCODE = '22023';
  END IF;

  v_mime := lower(btrim(COALESCE(p_mime_type, '')));
  IF v_mime IS DISTINCT FROM 'application/pdf' THEN
    RAISE EXCEPTION 'DOCUMENT_REGISTER_FAILED' USING ERRCODE = '22023';
  END IF;
  IF NOT public.expediente_documento_mime_permitido(v_mime, v_out.document_type) THEN
    RAISE EXCEPTION 'DOCUMENT_REGISTER_FAILED' USING ERRCODE = '22023';
  END IF;

  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'DOCUMENT_REGISTER_FAILED' USING ERRCODE = '22023';
  END IF;
  IF p_size_bytes > public.expediente_documento_max_size_bytes() THEN
    RAISE EXCEPTION 'DOCUMENT_REGISTER_FAILED' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects o
    WHERE o.bucket_id = 'expediente-documentos'
      AND o.name = v_expected_path
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_REGISTER_FAILED' USING ERRCODE = '22023';
  END IF;

  v_display := public.infonavit_pdf_display_filename(v_out.document_type);
  IF v_display IS NULL THEN
    RAISE EXCEPTION 'SNAPSHOT_CONTRACT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT e.id, e.organization_id, e.asesor_id, e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_out.expediente_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'DOCUMENT_REGISTER_FAILED' USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.asesor_id IS NULL THEN
    RAISE EXCEPTION 'DOCUMENT_REGISTER_FAILED' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.infonavit_pdf_outbox n
    WHERE n.expediente_id = v_out.expediente_id
      AND n.document_type = v_out.document_type
      AND n.status = 'done'
      AND n.submission_version > v_out.submission_version
  )
  INTO v_newer_exists;

  v_active := NOT COALESCE(v_newer_exists, false);

  SELECT COALESCE(MAX(d.version), 0) + 1
  INTO v_new_version
  FROM public.expediente_documentos d
  WHERE d.expediente_id = v_out.expediente_id
    AND d.tipo_documento = v_out.document_type;

  IF v_active THEN
    SELECT d.id
    INTO v_prev_id
    FROM public.expediente_documentos d
    WHERE d.expediente_id = v_out.expediente_id
      AND d.tipo_documento = v_out.document_type
      AND d.deleted_at IS NULL
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.expediente_documentos
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = v_prev_id;
    END IF;
  END IF;

  INSERT INTO public.expediente_documentos (
    organization_id,
    expediente_id,
    tipo_documento,
    storage_path,
    nombre_original,
    mime_type,
    size_bytes,
    version,
    estatus_revision,
    uploaded_by,
    uploaded_by_role,
    deleted_at
  ) VALUES (
    v_out.organization_id,
    v_out.expediente_id,
    v_out.document_type,
    v_expected_path,
    v_display,
    v_mime,
    p_size_bytes,
    v_new_version,
    'subido'::public.estatus_revision,
    v_exp.asesor_id,
    'sistema',
    CASE WHEN v_active THEN NULL ELSE NOW() END
  )
  RETURNING id INTO v_new_id;

  UPDATE public.infonavit_pdf_outbox
  SET
    status = 'done',
    documento_id = v_new_id,
    processed_at = NOW(),
    processing_started_at = NULL,
    last_error_code = NULL,
    updated_at = NOW()
  WHERE id = p_outbox_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_done', false,
    'outbox_id', p_outbox_id,
    'documento_id', v_new_id,
    'version', v_new_version,
    'active', v_active,
    'submission_version', v_out.submission_version,
    'document_type', v_out.document_type
  );
END;
$$;

COMMENT ON FUNCTION public.infonavit_pdf_complete_outbox(UUID, TEXT, TEXT, BIGINT) IS
  'P189 B4: registra PDF generado. Path derivado de outbox. Out-of-order: versión vieja histórica. Sin authenticated.';

-- =============================================================================
-- G) Grants — NUNCA authenticated / anon / PUBLIC
-- =============================================================================

REVOKE ALL ON FUNCTION public.infonavit_pdf_claim_outbox(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_load_claimed_job(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_fail_outbox(UUID, TEXT, BOOLEAN, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.infonavit_pdf_complete_outbox(UUID, TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.infonavit_pdf_claim_outbox(UUID, INTEGER)
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_load_claimed_job(UUID)
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_fail_outbox(UUID, TEXT, BOOLEAN, TIMESTAMPTZ)
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.infonavit_pdf_complete_outbox(UUID, TEXT, TEXT, BIGINT)
  TO postgres, service_role;
