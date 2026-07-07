-- Carta de la empresa (opcional): PDF o imagen, igual que INE en MIME permitido.

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

  IF v_tipo IN ('cliente_ine_frente', 'cliente_ine_reverso', 'cliente_carta_empresa')
     AND v_mime IN (
       'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
     ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT) IS
  'PDF para todos; imágenes en INE frente/reverso y carta de empresa (opcional).';
