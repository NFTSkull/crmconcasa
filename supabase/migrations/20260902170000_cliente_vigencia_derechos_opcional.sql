-- ConCasa CRM — Documento opcional asesor «Vigencia de derechos»
-- tipo canónico: cliente_vigencia_derechos
-- MIME allowlist + octet-stream (espejo asesor_evidencia); ≤15 MiB vía max_size global.
-- NO gate, NO obligatorio, NO Mesa upload, NO toca agenda/biométricos/firmas/P207.
-- Preserva P208: register usa asesor_can_operate_expediente_as (sin cambio).
-- Cloud max al escribir: 214 + timestamps ≤20260901194500. Sin drift en opcionales/MIME.

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
    'asesor_evidencia',
    'cliente_constancia_curp',
    'cliente_vigencia_derechos'
  ]::TEXT[];
$$;

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.integration_doc_tipos_asesor_envio()
      || public.integration_doc_tipos_asesor_opcionales();
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_opcionales() IS
  'Allowlist opcionales asesor; + cliente_vigencia_derechos (MIME allowlist ≤15 MiB; no gate).';

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload() IS
  'Tipos permitidos upload/register asesor (4 oblig + opcionales incl. vigencia de derechos).';

-- =============================================================================
-- MIME: vigencia = misma allowlist que evidencia; resto = Cloud 144 intacto
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

  -- Evidencia / Vigencia de derechos: allowlist + octet-stream (fallback FE)
  IF v_tipo IN ('asesor_evidencia', 'cliente_vigencia_derechos') THEN
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

  -- Pagaré / Notificación Mesa / Solicitud / Notificación compartida (apodaca)
  IF v_tipo IN (
       'cliente_pagare',
       'cliente_notificacion',
       'cliente_solicitud',
       'cliente_notificacion_apodaca'
     )
     AND v_mime IN ('image/jpeg', 'image/jpg', 'image/png') THEN
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
  'PDF global; excepciones imagen por tipo; asesor_evidencia/cliente_vigencia_derechos = allowlist + octet-stream.';

REVOKE ALL ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT)
  TO authenticated, service_role, postgres;

-- Bucket: MIME de vigencia ya cubiertos por allowlist de evidencia (mig 128). Idempotente.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
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
