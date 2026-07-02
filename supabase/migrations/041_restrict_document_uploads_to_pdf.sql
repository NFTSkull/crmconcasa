-- ConCasa CRM — go-live: expediente-documentos solo PDF (backend + bucket)
-- Reversible conceptualmente: restaurar lista MIME anterior en expediente_documento_mime_permitido y bucket.

CREATE OR REPLACE FUNCTION public.expediente_documento_mime_permitido(p_mime_type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(COALESCE(p_mime_type, ''))) = 'application/pdf';
$$;

COMMENT ON FUNCTION public.expediente_documento_mime_permitido(TEXT) IS
  'Go-live: solo application/pdf para uploads de expediente-documentos (asesor, mesa, corrección, retención).';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['application/pdf']::TEXT[]
WHERE id = 'expediente-documentos';
