-- ConCasa CRM — P3 shadow worker: claim/lease/complete (SIN OCR / SIN provider externo)
-- Incremental sobre 20260917210000. NO Cloud apply. NO upload hook. NO cron Production.

-- =============================================================================
-- 1) Feature flag worker — Vault FAIL-CLOSED DEFAULT OFF
-- =============================================================================
-- Ops (NO create_secret aquí):
--   document_extraction_worker_enabled = 'true'
--   document_extraction_worker_activation_at = ISO opcional

CREATE OR REPLACE FUNCTION public.document_extraction_worker_enabled()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_en TEXT;
  v_at TEXT;
  v_ts TIMESTAMPTZ;
BEGIN
  v_en := lower(COALESCE(public.document_extraction_vault_trimmed(
    'document_extraction_worker_enabled'
  ), ''));
  IF v_en IS DISTINCT FROM 'true' THEN
    RETURN false;
  END IF;

  v_at := public.document_extraction_vault_trimmed(
    'document_extraction_worker_activation_at'
  );
  IF v_at IS NULL OR btrim(v_at) = '' THEN
    RETURN true;
  END IF;

  BEGIN
    v_ts := v_at::TIMESTAMPTZ;
  EXCEPTION
    WHEN OTHERS THEN
      RETURN false;
  END;

  IF NOW() < v_ts THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$$;

COMMENT ON FUNCTION public.document_extraction_worker_enabled() IS
  'P3: worker DEFAULT OFF. true solo si Vault enabled=true (+ activation opcional).';

REVOKE ALL ON FUNCTION public.document_extraction_worker_enabled()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_extraction_worker_enabled()
  TO authenticated, service_role;

-- =============================================================================
-- 2) Lease + backoff determinísticos
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_worker_lease_interval()
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT INTERVAL '5 minutes';
$$;

COMMENT ON FUNCTION public.document_extraction_worker_lease_interval() IS
  'P3: lease del claim. Reclaim en el siguiente claim si vencido.';

CREATE OR REPLACE FUNCTION public.document_extraction_retry_backoff(p_attempts INTEGER)
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

COMMENT ON FUNCTION public.document_extraction_retry_backoff(INTEGER) IS
  'P3: backoff 1m/5m/15m/30m según attempts tras fail.';

CREATE OR REPLACE FUNCTION public.document_extraction_sanitize_error_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_code, '')), '') IS NULL THEN 'internal_error'
    WHEN length(btrim(p_code)) > 64 THEN left(btrim(p_code), 64)
    ELSE btrim(p_code)
  END;
$$;

REVOKE ALL ON FUNCTION public.document_extraction_worker_lease_interval()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.document_extraction_retry_backoff(INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.document_extraction_sanitize_error_code(TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.document_extraction_worker_lease_interval()
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.document_extraction_retry_backoff(INTEGER)
  TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.document_extraction_sanitize_error_code(TEXT)
  TO postgres, service_role;

-- =============================================================================
-- 3) Meta de job sin PII (storage_path + mime para worker)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_load_job_meta(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_doc RECORD;
BEGIN
  IF p_job_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_args');
  END IF;

  SELECT
    j.id,
    j.extraction_id,
    j.organization_id,
    j.expediente_id,
    j.documento_id,
    j.document_type,
    j.document_version,
    j.provider,
    j.provider_version,
    j.status,
    j.attempts,
    j.max_attempts,
    j.claimed_at,
    j.lease_expires_at
  INTO v_job
  FROM public.document_extraction_jobs j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'document_not_found');
  END IF;

  SELECT
    d.storage_path,
    d.mime_type,
    d.size_bytes,
    d.deleted_at
  INTO v_doc
  FROM public.expediente_documentos d
  WHERE d.id = v_job.documento_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'document_not_found',
      'job_id', v_job.id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job.id,
    'extraction_id', v_job.extraction_id,
    'organization_id', v_job.organization_id,
    'expediente_id', v_job.expediente_id,
    'documento_id', v_job.documento_id,
    'document_type', v_job.document_type,
    'document_version', v_job.document_version,
    'provider', v_job.provider,
    'provider_version', v_job.provider_version,
    'status', v_job.status,
    'attempts', v_job.attempts,
    'max_attempts', v_job.max_attempts,
    'claimed_at', v_job.claimed_at,
    'lease_expires_at', v_job.lease_expires_at,
    'documento_is_current', (v_doc.deleted_at IS NULL),
    'storage_bucket', 'expediente-documentos',
    'storage_path', v_doc.storage_path,
    'mime_type', v_doc.mime_type,
    'size_bytes', v_doc.size_bytes
  );
END;
$$;

COMMENT ON FUNCTION public.document_extraction_load_job_meta(UUID) IS
  'P3: meta job+storage sin payload_raw/PII. service_role only.';

REVOKE ALL ON FUNCTION public.document_extraction_load_job_meta(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_extraction_load_job_meta(UUID)
  TO service_role;

-- =============================================================================
-- 4) CLAIM — FOR UPDATE SKIP LOCKED
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_claim_jobs(
  p_limit INTEGER DEFAULT 3
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_lease INTERVAL;
  v_claimed JSONB := '[]'::JSONB;
BEGIN
  IF NOT public.document_extraction_worker_enabled() THEN
    RETURN jsonb_build_object(
      'ok', true,
      'claimed', '[]'::JSONB,
      'reason', 'feature_off'
    );
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 3), 5));
  v_lease := public.document_extraction_worker_lease_interval();

  WITH candidates AS (
    SELECT j.id
    FROM public.document_extraction_jobs j
    WHERE (
        (j.status = 'pending' AND j.available_at <= NOW())
        OR (
          j.status = 'failed'
          AND j.available_at <= NOW()
          AND j.attempts < j.max_attempts
        )
        OR (
          j.status = 'processing'
          AND j.lease_expires_at IS NOT NULL
          AND j.lease_expires_at < NOW()
        )
      )
    ORDER BY j.available_at ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.document_extraction_jobs j
    SET
      status = 'processing',
      attempts = j.attempts + 1,
      claimed_at = NOW(),
      lease_expires_at = NOW() + v_lease,
      last_error_code = NULL,
      updated_at = NOW()
    FROM candidates c
    WHERE j.id = c.id
    RETURNING
      j.id,
      j.extraction_id,
      j.documento_id,
      j.organization_id,
      j.expediente_id,
      j.document_type,
      j.document_version,
      j.provider,
      j.provider_version,
      j.attempts,
      j.max_attempts,
      j.claimed_at,
      j.lease_expires_at
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'job_id', u.id,
        'extraction_id', u.extraction_id,
        'documento_id', u.documento_id,
        'organization_id', u.organization_id,
        'expediente_id', u.expediente_id,
        'document_type', u.document_type,
        'document_version', u.document_version,
        'provider', u.provider,
        'provider_version', u.provider_version,
        'attempts', u.attempts,
        'max_attempts', u.max_attempts,
        'claimed_at', u.claimed_at,
        'lease_expires_at', u.lease_expires_at
      )
      ORDER BY u.claimed_at ASC
    ),
    '[]'::JSONB
  )
  INTO v_claimed
  FROM updated u;

  -- Sync extraction → processing (best-effort; no PII)
  UPDATE public.document_extractions e
  SET
    status = 'processing',
    started_at = COALESCE(e.started_at, NOW()),
    attempts = GREATEST(e.attempts, j.attempts),
    updated_at = NOW()
  FROM public.document_extraction_jobs j
  WHERE j.id IN (
      SELECT (x->>'job_id')::UUID
      FROM jsonb_array_elements(v_claimed) x
    )
    AND e.id = j.extraction_id
    AND e.status IN ('pending', 'failed', 'processing');

  RETURN jsonb_build_object(
    'ok', true,
    'claimed', COALESCE(v_claimed, '[]'::JSONB)
  );
END;
$$;

COMMENT ON FUNCTION public.document_extraction_claim_jobs(INTEGER) IS
  'P3: claim batch ≤5 con SKIP LOCKED + lease. Sin PII. service_role only.';

REVOKE ALL ON FUNCTION public.document_extraction_claim_jobs(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_extraction_claim_jobs(INTEGER)
  TO service_role;

-- =============================================================================
-- 5) MARK STALE (job + extraction)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_mark_stale(
  p_job_id UUID,
  p_reason TEXT DEFAULT 'document_not_current'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_reason TEXT;
BEGIN
  IF p_job_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_args');
  END IF;

  v_reason := COALESCE(
    NULLIF(btrim(COALESCE(p_reason, '')), ''),
    'document_not_current'
  );

  SELECT j.* INTO v_job
  FROM public.document_extraction_jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'document_not_found');
  END IF;

  IF v_job.status IN ('stale', 'done', 'dead', 'cancelled') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already', true,
      'status', v_job.status,
      'job_id', v_job.id
    );
  END IF;

  UPDATE public.document_extraction_jobs
  SET
    status = 'stale',
    last_error_code = public.document_extraction_sanitize_error_code(v_reason),
    lease_expires_at = NULL,
    updated_at = NOW()
  WHERE id = v_job.id;

  UPDATE public.document_extractions
  SET
    status = 'stale',
    stale_at = COALESCE(stale_at, NOW()),
    stale_reason = COALESCE(stale_reason, v_reason),
    updated_at = NOW()
  WHERE id = v_job.extraction_id
    AND status IS DISTINCT FROM 'stale';

  PERFORM public.log_action(
    v_job.organization_id,
    NULL,
    NULL,
    'document_extraction.stale',
    'document_extraction_job',
    v_job.id,
    jsonb_build_object(
      'extraction_id', v_job.extraction_id,
      'documento_id', v_job.documento_id,
      'document_type', v_job.document_type,
      'provider', v_job.provider,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job.id,
    'extraction_id', v_job.extraction_id,
    'status', 'stale'
  );
END;
$$;

COMMENT ON FUNCTION public.document_extraction_mark_stale(UUID, TEXT) IS
  'P3: marca job+extraction stale. No revive. Sin PII.';

REVOKE ALL ON FUNCTION public.document_extraction_mark_stale(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_extraction_mark_stale(UUID, TEXT)
  TO service_role;

-- =============================================================================
-- 6) MARK FAILED / DEAD + retry
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_mark_failed(
  p_job_id UUID,
  p_error_code TEXT,
  p_retryable BOOLEAN DEFAULT true,
  p_lease_claimed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_code TEXT;
  v_backoff INTERVAL;
  v_terminal BOOLEAN;
BEGIN
  IF p_job_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_args');
  END IF;

  v_code := public.document_extraction_sanitize_error_code(p_error_code);

  SELECT j.* INTO v_job
  FROM public.document_extraction_jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'document_not_found');
  END IF;

  IF v_job.status IN ('done', 'stale', 'dead', 'cancelled') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already', true,
      'status', v_job.status,
      'job_id', v_job.id
    );
  END IF;

  IF p_lease_claimed_at IS NOT NULL
     AND v_job.claimed_at IS DISTINCT FROM p_lease_claimed_at THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'lease_expired',
      'lease_lost', true,
      'job_id', v_job.id
    );
  END IF;

  v_terminal := (NOT COALESCE(p_retryable, true))
    OR (v_job.attempts >= v_job.max_attempts);

  IF v_terminal THEN
    UPDATE public.document_extraction_jobs
    SET
      status = 'dead',
      last_error_code = v_code,
      lease_expires_at = NULL,
      updated_at = NOW()
    WHERE id = v_job.id;

    UPDATE public.document_extractions
    SET
      status = 'failed',
      error_code = v_code,
      error_safe = v_code,
      processed_at = COALESCE(processed_at, NOW()),
      updated_at = NOW()
    WHERE id = v_job.extraction_id
      AND status IN ('pending', 'processing', 'failed');

    PERFORM public.log_action(
      v_job.organization_id, NULL, NULL,
      'document_extraction.dead',
      'document_extraction_job',
      v_job.id,
      jsonb_build_object(
        'extraction_id', v_job.extraction_id,
        'documento_id', v_job.documento_id,
        'document_type', v_job.document_type,
        'provider', v_job.provider,
        'error_code', v_code,
        'attempts', v_job.attempts
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'job_id', v_job.id,
      'status', 'dead',
      'error_code', v_code
    );
  END IF;

  v_backoff := public.document_extraction_retry_backoff(v_job.attempts);

  UPDATE public.document_extraction_jobs
  SET
    status = 'failed',
    available_at = NOW() + v_backoff,
    last_error_code = v_code,
    lease_expires_at = NULL,
    updated_at = NOW()
  WHERE id = v_job.id;

  UPDATE public.document_extractions
  SET
    status = 'failed',
    error_code = v_code,
    error_safe = v_code,
    updated_at = NOW()
  WHERE id = v_job.extraction_id
    AND status IN ('pending', 'processing', 'failed');

  PERFORM public.log_action(
    v_job.organization_id, NULL, NULL,
    'document_extraction.failed',
    'document_extraction_job',
    v_job.id,
    jsonb_build_object(
      'extraction_id', v_job.extraction_id,
      'documento_id', v_job.documento_id,
      'document_type', v_job.document_type,
      'provider', v_job.provider,
      'error_code', v_code,
      'attempts', v_job.attempts,
      'retry_in_seconds', EXTRACT(EPOCH FROM v_backoff)::INTEGER
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job.id,
    'status', 'failed',
    'error_code', v_code,
    'available_at', (NOW() + v_backoff)
  );
END;
$$;

COMMENT ON FUNCTION public.document_extraction_mark_failed(UUID, TEXT, BOOLEAN, TIMESTAMPTZ) IS
  'P3: fail con backoff o dead si max_attempts. Sin PII.';

REVOKE ALL ON FUNCTION public.document_extraction_mark_failed(UUID, TEXT, BOOLEAN, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_extraction_mark_failed(UUID, TEXT, BOOLEAN, TIMESTAMPTZ)
  TO service_role;

-- =============================================================================
-- 7) COMPLETE atómico (job + extraction) + vigencia doble
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_complete_job(
  p_job_id UUID,
  p_payload_normalized JSONB DEFAULT '{"fields":{}}'::JSONB,
  p_payload_raw JSONB DEFAULT NULL,
  p_lease_claimed_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job RECORD;
  v_ext RECORD;
BEGIN
  IF p_job_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_args');
  END IF;

  SELECT j.* INTO v_job
  FROM public.document_extraction_jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'document_not_found');
  END IF;

  -- Ya terminal: no revivir stale/done/dead
  IF v_job.status = 'stale' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'document_not_current',
      'status', 'stale',
      'revived', false,
      'job_id', v_job.id
    );
  END IF;

  IF v_job.status = 'done' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already', true,
      'status', 'done',
      'job_id', v_job.id
    );
  END IF;

  IF v_job.status IN ('dead', 'cancelled') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'complete_conflict',
      'status', v_job.status,
      'job_id', v_job.id
    );
  END IF;

  IF v_job.status IS DISTINCT FROM 'processing' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'complete_conflict',
      'status', v_job.status,
      'job_id', v_job.id
    );
  END IF;

  IF p_lease_claimed_at IS NOT NULL
     AND v_job.claimed_at IS DISTINCT FROM p_lease_claimed_at THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'lease_expired',
      'lease_lost', true,
      'job_id', v_job.id
    );
  END IF;

  IF v_job.lease_expires_at IS NOT NULL AND v_job.lease_expires_at < NOW() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'lease_expired',
      'job_id', v_job.id
    );
  END IF;

  -- Vigencia crítica (antes de guardar)
  IF NOT public.document_extraction_documento_is_current(v_job.documento_id) THEN
    RETURN public.document_extraction_mark_stale(v_job.id, 'document_not_current');
  END IF;

  SELECT e.* INTO v_ext
  FROM public.document_extractions e
  WHERE e.id = v_job.extraction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'document_not_found');
  END IF;

  IF v_ext.status = 'stale' THEN
    UPDATE public.document_extraction_jobs
    SET status = 'stale', lease_expires_at = NULL, updated_at = NOW()
    WHERE id = v_job.id;
    RETURN jsonb_build_object(
      'ok', false,
      'error_code', 'document_not_current',
      'status', 'stale',
      'revived', false,
      'job_id', v_job.id
    );
  END IF;

  -- Re-check vigencia inmediatamente antes de commit lógico
  IF NOT public.document_extraction_documento_is_current(v_job.documento_id) THEN
    RETURN public.document_extraction_mark_stale(v_job.id, 'document_not_current');
  END IF;

  UPDATE public.document_extractions
  SET
    status = 'done',
    payload_normalized = COALESCE(p_payload_normalized, '{"fields":{}}'::JSONB),
    payload_raw = p_payload_raw,
    error_code = NULL,
    error_safe = NULL,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE id = v_ext.id;

  UPDATE public.document_extraction_jobs
  SET
    status = 'done',
    last_error_code = NULL,
    lease_expires_at = NULL,
    updated_at = NOW()
  WHERE id = v_job.id;

  PERFORM public.log_action(
    v_job.organization_id, NULL, NULL,
    'document_extraction.done',
    'document_extraction_job',
    v_job.id,
    jsonb_build_object(
      'extraction_id', v_job.extraction_id,
      'documento_id', v_job.documento_id,
      'document_type', v_job.document_type,
      'provider', v_job.provider,
      'provider_version', v_job.provider_version,
      'document_version', v_job.document_version
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', v_job.id,
    'extraction_id', v_job.extraction_id,
    'status', 'done'
  );
END;
$$;

COMMENT ON FUNCTION public.document_extraction_complete_job(UUID, JSONB, JSONB, TIMESTAMPTZ) IS
  'P3: complete atómico job+extraction. Stale no revive. Sin log PII.';

REVOKE ALL ON FUNCTION public.document_extraction_complete_job(UUID, JSONB, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_extraction_complete_job(UUID, JSONB, JSONB, TIMESTAMPTZ)
  TO service_role;
