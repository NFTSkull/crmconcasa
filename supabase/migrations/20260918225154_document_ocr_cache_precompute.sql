-- ConCasa CRM — OCR precalentado para documentos INFONAVIT.
-- Objetivo: leer una sola vez al subir/reemplazar y reutilizar en Mesa.
-- Cache privada: authenticated NO tiene acceso directo; Mesa consume RPC con can_see_expediente.
-- Fallback actual de OCR en navegador se conserva.

CREATE TABLE IF NOT EXISTS public.document_ocr_cache (
  documento_id UUID PRIMARY KEY
    REFERENCES public.expediente_documentos(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','done','failed')),
  engine TEXT,
  pages INTEGER CHECK (pages IS NULL OR pages >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  ocr_text TEXT,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.document_ocr_cache IS
  'Cache privada OCR por versión real de expediente_documentos. ocr_text contiene PII; sin SELECT directo authenticated.';

CREATE INDEX IF NOT EXISTS document_ocr_cache_status_idx
  ON public.document_ocr_cache(status, updated_at)
  WHERE status IN ('pending','processing','failed');

ALTER TABLE public.document_ocr_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_ocr_cache FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.document_ocr_cache
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.document_ocr_cache
  TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.document_ocr_cache_allowed_types()
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

REVOKE ALL ON FUNCTION public.document_ocr_cache_allowed_types()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_ocr_cache_allowed_types()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.document_ocr_prepare_current(
  p_expediente_id UUID,
  p_document_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role public.app_role;
  v_active BOOLEAN;
  v_doc public.expediente_documentos%ROWTYPE;
  v_status TEXT;
BEGIN
  IF v_uid IS NULL OR p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'document_ocr_prepare_current: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (COALESCE(p_document_type,'') = ANY (public.document_ocr_cache_allowed_types())) THEN
    RAISE EXCEPTION 'document_ocr_prepare_current: tipo no permitido'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.app_role, p.active
    INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_active IS DISTINCT FROM true
     OR v_role NOT IN ('asesor','mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'document_ocr_prepare_current: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'document_ocr_prepare_current: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  SELECT d.*
    INTO v_doc
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.tipo_documento = p_document_type
    AND d.deleted_at IS NULL
  ORDER BY d.version DESC, d.created_at DESC, d.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'found', false,
      'documentType', p_document_type
    );
  END IF;

  INSERT INTO public.document_ocr_cache (
    documento_id, status, attempts, created_at, updated_at
  ) VALUES (
    v_doc.id, 'pending', 0, NOW(), NOW()
  )
  ON CONFLICT (documento_id) DO UPDATE SET
    status = CASE
      WHEN public.document_ocr_cache.status = 'done' THEN 'done'
      WHEN public.document_ocr_cache.status = 'processing'
           AND public.document_ocr_cache.started_at > NOW() - INTERVAL '2 minutes'
        THEN 'processing'
      ELSE 'pending'
    END,
    started_at = CASE
      WHEN public.document_ocr_cache.status = 'processing'
           AND public.document_ocr_cache.started_at > NOW() - INTERVAL '2 minutes'
        THEN public.document_ocr_cache.started_at
      WHEN public.document_ocr_cache.status = 'done'
        THEN public.document_ocr_cache.started_at
      ELSE NULL
    END,
    error_code = CASE
      WHEN public.document_ocr_cache.status = 'done' THEN public.document_ocr_cache.error_code
      ELSE NULL
    END,
    updated_at = NOW();

  SELECT c.status INTO v_status
  FROM public.document_ocr_cache c
  WHERE c.documento_id = v_doc.id;

  RETURN jsonb_build_object(
    'ok', true,
    'found', true,
    'documentoId', v_doc.id,
    'expedienteId', v_doc.expediente_id,
    'documentType', v_doc.tipo_documento,
    'documentVersion', v_doc.version,
    'storagePath', v_doc.storage_path,
    'filename', v_doc.nombre_original,
    'mimeType', v_doc.mime_type,
    'cacheStatus', v_status
  );
END;
$$;

COMMENT ON FUNCTION public.document_ocr_prepare_current(UUID, TEXT) IS
  'Autoriza asesor/Mesa visible y prepara cache OCR de la versión vigente. No expone texto OCR.';

REVOKE ALL ON FUNCTION public.document_ocr_prepare_current(UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_ocr_prepare_current(UUID, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mesa_get_infonavit_ocr_cache(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role public.app_role;
  v_active BOOLEAN;
  v_result JSONB;
BEGIN
  IF v_uid IS NULL OR p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_get_infonavit_ocr_cache: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active
    INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_active IS DISTINCT FROM true
     OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'mesa_get_infonavit_ocr_cache: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_get_infonavit_ocr_cache: expediente no visible'
      USING ERRCODE = '42501';
  END IF;

  WITH current_docs AS (
    SELECT DISTINCT ON (d.tipo_documento)
      d.id,
      d.tipo_documento,
      d.version
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND d.deleted_at IS NULL
      AND d.tipo_documento = ANY (public.document_ocr_cache_allowed_types())
    ORDER BY d.tipo_documento, d.version DESC, d.created_at DESC, d.id DESC
  )
  SELECT COALESCE(
    jsonb_object_agg(
      d.tipo_documento,
      jsonb_build_object(
        'documentoId', d.id,
        'documentVersion', d.version,
        'status', COALESCE(c.status, 'missing'),
        'text', CASE WHEN c.status = 'done' THEN COALESCE(c.ocr_text,'') ELSE '' END,
        'engine', c.engine,
        'pages', c.pages,
        'durationMs', c.duration_ms,
        'processedAt', c.processed_at
      )
    ),
    '{}'::jsonb
  )
  INTO v_result
  FROM current_docs d
  LEFT JOIN public.document_ocr_cache c ON c.documento_id = d.id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.mesa_get_infonavit_ocr_cache(UUID) IS
  'Mesa: cache OCR de documentos vigentes del expediente. Texto PII solo si can_see_expediente y rol Mesa.';

REVOKE ALL ON FUNCTION public.mesa_get_infonavit_ocr_cache(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_get_infonavit_ocr_cache(UUID)
  TO authenticated, service_role;
