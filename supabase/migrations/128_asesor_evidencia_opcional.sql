-- ConCasa CRM — Documento opcional asesor «Evidencia» (`asesor_evidencia`)
-- Reutiliza register_expediente_documento + bucket expediente-documentos.
-- No es gate, no obligatorio, no afecta Pagaré/P090/montos/etapas.
-- No modifica migraciones 001–127.

-- =============================================================================
-- Allowlist opcionales asesor (+ upload vía integration_doc_tipos_asesor_upload)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_opcionales()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_semanas_cotizadas',
    'cliente_carta_empresa',
    'cliente_acta_nacimiento_digital',
    'cliente_notificacion_apodaca',
    'cliente_notificacion',
    'asesor_evidencia'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_opcionales() IS
  'Allowlist opcionales asesor; incluye asesor_evidencia (MIME allowlist ≤15 MiB; no gate).';

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload() IS
  'Tipos permitidos upload/register asesor (4 oblig + opcionales incl. asesor_evidencia).';

-- =============================================================================
-- MIME: asesor_evidencia = allowlist explícita; resto intacto (P117)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.expediente_documento_mime_permitido(
  p_mime_type text,
  p_tipo_documento text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_mime TEXT;
  v_tipo TEXT;
BEGIN
  v_mime := lower(btrim(COALESCE(p_mime_type, '')));
  v_tipo := NULLIF(lower(btrim(COALESCE(p_tipo_documento, ''))), '');

  -- Evidencia: solo MIME comunes de la allowlist (octet-stream = fallback FE)
  IF v_tipo = 'asesor_evidencia' THEN
    RETURN v_mime IN (
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'text/plain',
      'text/csv',
      'application/json',
      'application/xml',
      'text/xml',
      'application/zip',
      'application/x-rar-compressed',
      'application/vnd.rar',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/octet-stream'
    );
  END IF;

  IF v_mime = 'application/pdf' THEN
    RETURN TRUE;
  END IF;

  IF v_tipo IN ('retencion_acuse_con_sello', 'retencion_carta_sin_sello')
     AND v_mime IN ('image/jpeg', 'image/jpg', 'image/png') THEN
    RETURN TRUE;
  END IF;

  IF v_tipo IN ('cliente_pagare', 'cliente_notificacion', 'cliente_solicitud')
     AND v_mime IN ('image/jpeg', 'image/png') THEN
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
$function$;

COMMENT ON FUNCTION public.expediente_documento_mime_permitido(text, text) IS
  'PDF global; excepciones imagen por tipo; asesor_evidencia = allowlist MIME común + octet-stream.';

REVOKE ALL ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- Bucket: conserva MIME actuales (047) y agrega solo los de Evidencia faltantes
-- =============================================================================
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  -- vigentes previos (INE / PDF / imágenes)
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  -- Evidencia (comunes + fallback)
  'text/plain',
  'text/csv',
  'application/json',
  'application/xml',
  'text/xml',
  'application/zip',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream'
]::TEXT[]
WHERE id = 'expediente-documentos';
