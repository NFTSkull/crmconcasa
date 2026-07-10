-- ConCasa CRM — Documento opcional asesor: Cliente · Acta de nacimiento digital
-- No altera gate obligatorio (4/4) ni complementarios Mesa.

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_opcionales()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_semanas_cotizadas',
    'cliente_carta_empresa',
    'cliente_acta_nacimiento_digital'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_opcionales() IS
  'P062: tipos opcionales de upload asesor (no bloquean enviar_a_mesa). Incluye semanas, carta empresa y acta nacimiento digital.';

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload() IS
  'P062: tipos permitidos para upload/register asesor (4 oblig + 3 opcionales = 7). Excluye acta/constancia SAT (Mesa).';

-- Acta nacimiento digital (opcional): PDF o imagen, igual que carta empresa / INE.

CREATE OR REPLACE FUNCTION public.expediente_documento_mime_permitido(
  p_mime_type TEXT,
  p_tipo_documento TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_mime TEXT;
  v_tipo TEXT;
BEGIN
  v_mime := lower(btrim(COALESCE(p_mime_type, '')));
  v_tipo := NULLIF(lower(btrim(COALESCE(p_tipo_documento, ''))), '');

  IF v_mime = 'application/pdf' THEN
    RETURN TRUE;
  END IF;

  IF v_tipo IN (
       'cliente_ine_frente',
       'cliente_ine_reverso',
       'cliente_carta_empresa',
       'cliente_acta_nacimiento_digital'
     )
     AND v_mime IN (
       'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
     ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT) IS
  'PDF para todos; imágenes en INE, carta empresa y acta nacimiento digital (opcionales).';
