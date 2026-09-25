-- ConCasa CRM — RFC fiscal detectado desde Estado de Cuenta vigente.
-- Persiste el candidato fiscal en el cache OCR privado, ligado 1:1 a documento_id/version.
-- No modifica rfc_infonavit ni cliente_datos.rfc. Es una fuente fiscal separada.

ALTER TABLE public.document_ocr_cache
  ADD COLUMN IF NOT EXISTS fiscal_rfc TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_rfc_status TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_rfc_reason TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_rfc_read_source TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_rfc_confidence TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_rfc_resolved_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_ocr_cache_fiscal_rfc_status_chk'
      AND conrelid = 'public.document_ocr_cache'::regclass
  ) THEN
    ALTER TABLE public.document_ocr_cache
      ADD CONSTRAINT document_ocr_cache_fiscal_rfc_status_chk
      CHECK (
        fiscal_rfc_status IS NULL
        OR fiscal_rfc_status IN ('pending','ready','unknown')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_ocr_cache_fiscal_rfc_source_chk'
      AND conrelid = 'public.document_ocr_cache'::regclass
  ) THEN
    ALTER TABLE public.document_ocr_cache
      ADD CONSTRAINT document_ocr_cache_fiscal_rfc_source_chk
      CHECK (
        fiscal_rfc_read_source IS NULL
        OR fiscal_rfc_read_source IN ('embedded_text','ocr_cache','ocr_live')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_ocr_cache_fiscal_rfc_confidence_chk'
      AND conrelid = 'public.document_ocr_cache'::regclass
  ) THEN
    ALTER TABLE public.document_ocr_cache
      ADD CONSTRAINT document_ocr_cache_fiscal_rfc_confidence_chk
      CHECK (
        fiscal_rfc_confidence IS NULL
        OR fiscal_rfc_confidence IN ('high','medium','none')
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.document_ocr_cache.fiscal_rfc IS
  'RFC fiscal completo detectado exclusivamente desde el Estado de Cuenta vigente. PII privada; sin SELECT authenticated.';
COMMENT ON COLUMN public.document_ocr_cache.fiscal_rfc_status IS
  'pending|ready|unknown para la detección fiscal del documento.';
COMMENT ON COLUMN public.document_ocr_cache.fiscal_rfc_read_source IS
  'Fuente de lectura del mismo documento: embedded_text|ocr_cache|ocr_live.';
COMMENT ON COLUMN public.document_ocr_cache.fiscal_rfc_reason IS
  'Razón técnica de selección/no selección, sin incluir RFC completo.';
COMMENT ON COLUMN public.document_ocr_cache.fiscal_rfc_confidence IS
  'Confianza de selección del RFC del titular.';
