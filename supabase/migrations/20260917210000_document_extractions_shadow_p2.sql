-- ConCasa CRM — P2 shadow: document_extractions + jobs (SIN OCR / SIN provider / SIN upload hook)
-- DEFAULT OFF (Vault document_extraction_enqueue_enabled). NO vault.create_secret aquí.
-- NO Cloud apply en este PR. NO backfill. NO tocar P189/agenda/citas/Sheets.

-- =============================================================================
-- 1) Allowlist de tipos (4 documentos cliente)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_tipos_permitidos()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_ine_frente',
    'cliente_ine_reverso',
    'cliente_comprobante_domicilio',
    'cliente_estado_cuenta'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.document_extraction_tipos_permitidos() IS
  'P2: allowlist explícita de tipos para extracción documental shadow.';

REVOKE ALL ON FUNCTION public.document_extraction_tipos_permitidos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_extraction_tipos_permitidos() TO authenticated, service_role;

-- =============================================================================
-- 2) Feature flag Vault — FAIL-CLOSED DEFAULT OFF
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_vault_trimmed(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v TEXT;
BEGIN
  SELECT NULLIF(btrim(ds.decrypted_secret), '')
  INTO v
  FROM vault.decrypted_secrets ds
  WHERE ds.name = p_name
  LIMIT 1;
  RETURN v;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.document_extraction_vault_trimmed(TEXT) IS
  'P2: lee secreto Vault; falla → NULL (fail-closed). NO loguea el valor.';

REVOKE ALL ON FUNCTION public.document_extraction_vault_trimmed(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_extraction_vault_trimmed(TEXT)
  TO service_role;

-- Secrets (ops, NO create_secret en migration):
--   document_extraction_enqueue_enabled = 'true' para habilitar enqueue
--   document_extraction_activation_at   = ISO timestamptz opcional
CREATE OR REPLACE FUNCTION public.document_extraction_feature_enabled()
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
    'document_extraction_enqueue_enabled'
  ), ''));
  IF v_en IS DISTINCT FROM 'true' THEN
    RETURN false;
  END IF;

  v_at := public.document_extraction_vault_trimmed(
    'document_extraction_activation_at'
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

COMMENT ON FUNCTION public.document_extraction_feature_enabled() IS
  'P2: DEFAULT OFF. true solo si Vault enabled=true y activation_at vacío o ya pasado.';

REVOKE ALL ON FUNCTION public.document_extraction_feature_enabled()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_extraction_feature_enabled()
  TO authenticated, service_role;

-- =============================================================================
-- 3) Tabla document_extractions (resultado; payload_raw = PII)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  documento_id UUID NOT NULL REFERENCES public.expediente_documentos(id) ON DELETE CASCADE,
  document_version INTEGER NOT NULL CHECK (document_version >= 1),
  document_type TEXT NOT NULL
    CHECK (document_type = ANY (ARRAY[
      'cliente_ine_frente',
      'cliente_ine_reverso',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta'
    ]::TEXT[])),
  provider TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'stale', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  payload_normalized JSONB,
  payload_raw JSONB,
  error_code TEXT,
  error_safe TEXT,
  stale_at TIMESTAMPTZ,
  stale_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_extractions_unique_doc_provider
    UNIQUE (documento_id, provider, provider_version)
);

COMMENT ON TABLE public.document_extractions IS
  'P2 shadow: resultado de extracción documental. payload_raw = PII; sin SELECT authenticated.';

COMMENT ON COLUMN public.document_extractions.documento_id IS
  'UUID de la fila expediente_documentos (cada versión de archivo = id nuevo).';

COMMENT ON COLUMN public.document_extractions.document_version IS
  'Denormalizado desde expediente_documentos.version al encolar.';

CREATE INDEX IF NOT EXISTS document_extractions_expediente_tipo_idx
  ON public.document_extractions (expediente_id, document_type, created_at DESC);

CREATE INDEX IF NOT EXISTS document_extractions_status_idx
  ON public.document_extractions (status, created_at ASC)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_extractions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.document_extractions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.document_extractions
  TO postgres, service_role;

-- =============================================================================
-- 4) Cola document_extraction_jobs (sin claim en P2)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.document_extraction_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id UUID NOT NULL REFERENCES public.document_extractions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  documento_id UUID NOT NULL REFERENCES public.expediente_documentos(id) ON DELETE CASCADE,
  document_version INTEGER NOT NULL CHECK (document_version >= 1),
  document_type TEXT NOT NULL
    CHECK (document_type = ANY (ARRAY[
      'cliente_ine_frente',
      'cliente_ine_reverso',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta'
    ]::TEXT[])),
  provider TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN (
      'pending', 'processing', 'done', 'failed', 'dead', 'cancelled', 'stale'
    )),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_extraction_jobs_unique_doc_provider
    UNIQUE (documento_id, provider, provider_version)
);

COMMENT ON TABLE public.document_extraction_jobs IS
  'P2 shadow: cola outbox de extracciones. Claim/lease en P3. Sin PII.';

CREATE INDEX IF NOT EXISTS document_extraction_jobs_pending_idx
  ON public.document_extraction_jobs (available_at ASC, created_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS document_extraction_jobs_processing_lease_idx
  ON public.document_extraction_jobs (lease_expires_at ASC)
  WHERE status = 'processing';

ALTER TABLE public.document_extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_extraction_jobs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.document_extraction_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.document_extraction_jobs
  TO postgres, service_role;

-- =============================================================================
-- 5) Integridad: fila alineada al expediente_documentos real
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_document_extraction_row_align_documento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc RECORD;
BEGIN
  SELECT
    d.organization_id,
    d.expediente_id,
    d.tipo_documento,
    d.version
  INTO v_doc
  FROM public.expediente_documentos d
  WHERE d.id = NEW.documento_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_extraction: documento_id inexistente';
  END IF;

  IF NEW.organization_id IS DISTINCT FROM v_doc.organization_id THEN
    RAISE EXCEPTION 'document_extraction: organization_id no coincide con documento';
  END IF;
  IF NEW.expediente_id IS DISTINCT FROM v_doc.expediente_id THEN
    RAISE EXCEPTION 'document_extraction: expediente_id no coincide con documento';
  END IF;
  IF NEW.document_type IS DISTINCT FROM v_doc.tipo_documento THEN
    RAISE EXCEPTION 'document_extraction: document_type no coincide con documento';
  END IF;
  IF NEW.document_version IS DISTINCT FROM v_doc.version THEN
    RAISE EXCEPTION 'document_extraction: document_version no coincide con documento';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_document_extraction_row_align_documento() IS
  'P2: impide org/expediente/tipo/version desalineados del documento_id.';

REVOKE ALL ON FUNCTION public.trg_document_extraction_row_align_documento()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS document_extractions_align_documento
  ON public.document_extractions;
CREATE TRIGGER document_extractions_align_documento
  BEFORE INSERT OR UPDATE OF
    organization_id, expediente_id, documento_id, document_type, document_version
  ON public.document_extractions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_document_extraction_row_align_documento();

DROP TRIGGER IF EXISTS document_extraction_jobs_align_documento
  ON public.document_extraction_jobs;
CREATE TRIGGER document_extraction_jobs_align_documento
  BEFORE INSERT OR UPDATE OF
    organization_id, expediente_id, documento_id, document_type, document_version
  ON public.document_extraction_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_document_extraction_row_align_documento();

-- =============================================================================
-- 6) ¿Documento vigente (current)?
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_documento_is_current(
  p_documento_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted TIMESTAMPTZ;
BEGIN
  IF p_documento_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT d.deleted_at INTO v_deleted
  FROM public.expediente_documentos d
  WHERE d.id = p_documento_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  RETURN v_deleted IS NULL;
END;
$$;

COMMENT ON FUNCTION public.document_extraction_documento_is_current(UUID) IS
  'P2: true si expediente_documentos.deleted_at IS NULL (versión activa del tipo).';

REVOKE ALL ON FUNCTION public.document_extraction_documento_is_current(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_extraction_documento_is_current(UUID)
  TO service_role;

-- =============================================================================
-- 7) Marcar STALE extracciones/jobs de versiones sustituidas
-- =============================================================================
CREATE OR REPLACE FUNCTION public.document_extraction_mark_stale_superseded(
  p_expediente_id UUID,
  p_document_type TEXT,
  p_keep_documento_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER := 0;
  v_n2 INTEGER := 0;
BEGIN
  IF p_expediente_id IS NULL OR p_document_type IS NULL OR p_keep_documento_id IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.document_extractions e
  SET
    status = 'stale',
    stale_at = COALESCE(e.stale_at, NOW()),
    stale_reason = COALESCE(e.stale_reason, 'superseded_by_newer_document'),
    updated_at = NOW()
  WHERE e.expediente_id = p_expediente_id
    AND e.document_type = p_document_type
    AND e.documento_id IS DISTINCT FROM p_keep_documento_id
    AND e.status IN ('pending', 'processing', 'done', 'failed', 'skipped');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.document_extraction_jobs j
  SET
    status = 'stale',
    updated_at = NOW()
  WHERE j.expediente_id = p_expediente_id
    AND j.document_type = p_document_type
    AND j.documento_id IS DISTINCT FROM p_keep_documento_id
    AND j.status IN ('pending', 'processing', 'failed');
  GET DIAGNOSTICS v_n2 = ROW_COUNT;

  RETURN v_n + v_n2;
END;
$$;

COMMENT ON FUNCTION public.document_extraction_mark_stale_superseded(UUID, TEXT, UUID) IS
  'P2: marca extracciones/jobs de versiones anteriores como stale. Sin PII.';

REVOKE ALL ON FUNCTION public.document_extraction_mark_stale_superseded(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_extraction_mark_stale_superseded(UUID, TEXT, UUID)
  TO service_role;

-- =============================================================================
-- 8) Enqueue (NO cableado a register_expediente_documento)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enqueue_document_extraction(
  p_documento_id UUID,
  p_provider TEXT DEFAULT 'shadow',
  p_provider_version TEXT DEFAULT 'p2'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc RECORD;
  v_provider TEXT;
  v_provider_version TEXT;
  v_extraction_id UUID;
  v_job_id UUID;
  v_stale_n INTEGER;
BEGIN
  v_provider := NULLIF(btrim(COALESCE(p_provider, '')), '');
  v_provider_version := NULLIF(btrim(COALESCE(p_provider_version, '')), '');
  IF p_documento_id IS NULL OR v_provider IS NULL OR v_provider_version IS NULL THEN
    RETURN jsonb_build_object(
      'enqueued', false,
      'reason', 'invalid_args'
    );
  END IF;

  IF NOT public.document_extraction_feature_enabled() THEN
    RETURN jsonb_build_object(
      'enqueued', false,
      'reason', 'feature_off'
    );
  END IF;

  SELECT
    d.id,
    d.organization_id,
    d.expediente_id,
    d.tipo_documento,
    d.version,
    d.deleted_at
  INTO v_doc
  FROM public.expediente_documentos d
  WHERE d.id = p_documento_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'documento_not_found');
  END IF;

  IF v_doc.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('enqueued', false, 'reason', 'documento_deleted');
  END IF;

  IF NOT (v_doc.tipo_documento = ANY (public.document_extraction_tipos_permitidos())) THEN
    RETURN jsonb_build_object(
      'enqueued', false,
      'reason', 'tipo_not_allowed',
      'document_type', v_doc.tipo_documento
    );
  END IF;

  -- Versiones anteriores del mismo tipo → stale (v1 no queda vigente si existe v2).
  v_stale_n := public.document_extraction_mark_stale_superseded(
    v_doc.expediente_id,
    v_doc.tipo_documento,
    v_doc.id
  );

  INSERT INTO public.document_extractions (
    organization_id,
    expediente_id,
    documento_id,
    document_version,
    document_type,
    provider,
    provider_version,
    status,
    attempts
  ) VALUES (
    v_doc.organization_id,
    v_doc.expediente_id,
    v_doc.id,
    v_doc.version,
    v_doc.tipo_documento,
    v_provider,
    v_provider_version,
    'pending',
    0
  )
  ON CONFLICT (documento_id, provider, provider_version) DO NOTHING
  RETURNING id INTO v_extraction_id;

  IF v_extraction_id IS NULL THEN
    SELECT e.id INTO v_extraction_id
    FROM public.document_extractions e
    WHERE e.documento_id = v_doc.id
      AND e.provider = v_provider
      AND e.provider_version = v_provider_version;
    RETURN jsonb_build_object(
      'enqueued', false,
      'reason', 'already_enqueued',
      'extraction_id', v_extraction_id,
      'documento_id', v_doc.id,
      'document_type', v_doc.tipo_documento,
      'document_version', v_doc.version,
      'stale_marked', v_stale_n
    );
  END IF;

  INSERT INTO public.document_extraction_jobs (
    extraction_id,
    organization_id,
    expediente_id,
    documento_id,
    document_version,
    document_type,
    provider,
    provider_version,
    status,
    attempts,
    available_at
  ) VALUES (
    v_extraction_id,
    v_doc.organization_id,
    v_doc.expediente_id,
    v_doc.id,
    v_doc.version,
    v_doc.tipo_documento,
    v_provider,
    v_provider_version,
    'pending',
    0,
    NOW()
  )
  ON CONFLICT (documento_id, provider, provider_version) DO NOTHING
  RETURNING id INTO v_job_id;

  PERFORM public.log_action(
    v_doc.organization_id,
    NULL,
    NULL,
    'document_extraction.enqueued',
    'expediente_documento',
    v_doc.id,
    jsonb_build_object(
      'extraction_id', v_extraction_id,
      'job_id', v_job_id,
      'document_type', v_doc.tipo_documento,
      'document_version', v_doc.version,
      'provider', v_provider,
      'provider_version', v_provider_version,
      'stale_marked', v_stale_n
    )
  );

  RETURN jsonb_build_object(
    'enqueued', true,
    'reason', 'ok',
    'extraction_id', v_extraction_id,
    'job_id', v_job_id,
    'documento_id', v_doc.id,
    'document_type', v_doc.tipo_documento,
    'document_version', v_doc.version,
    'stale_marked', v_stale_n
  );
END;
$$;

COMMENT ON FUNCTION public.enqueue_document_extraction(UUID, TEXT, TEXT) IS
  'P2: encola extracción shadow. Resuelve org/expediente/tipo/version server-side. Idempotente. NO OCR. service_role only. NO cableado a upload.';

REVOKE ALL ON FUNCTION public.enqueue_document_extraction(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_document_extraction(UUID, TEXT, TEXT)
  TO service_role;
