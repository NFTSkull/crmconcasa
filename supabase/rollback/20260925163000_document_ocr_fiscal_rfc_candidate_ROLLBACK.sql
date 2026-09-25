-- Rollback de metadata RFC fiscal en cache OCR.
ALTER TABLE public.document_ocr_cache
  DROP CONSTRAINT IF EXISTS document_ocr_cache_fiscal_rfc_confidence_chk,
  DROP CONSTRAINT IF EXISTS document_ocr_cache_fiscal_rfc_source_chk,
  DROP CONSTRAINT IF EXISTS document_ocr_cache_fiscal_rfc_status_chk,
  DROP COLUMN IF EXISTS fiscal_rfc_resolved_at,
  DROP COLUMN IF EXISTS fiscal_rfc_confidence,
  DROP COLUMN IF EXISTS fiscal_rfc_read_source,
  DROP COLUMN IF EXISTS fiscal_rfc_reason,
  DROP COLUMN IF EXISTS fiscal_rfc_status,
  DROP COLUMN IF EXISTS fiscal_rfc;
