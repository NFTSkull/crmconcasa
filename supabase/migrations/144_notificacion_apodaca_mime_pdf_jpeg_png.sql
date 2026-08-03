-- ConCasa CRM — Hotfix: Notificación (`cliente_notificacion_apodaca`) acepta PDF/JPEG/PNG
-- Migración 144. Solo amplía MIME de ese tipo; no toca Acuse, etapas, agenda ni otros docs.

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
  'PDF global; excepciones imagen por tipo; cliente_notificacion_apodaca = PDF/JPEG/PNG; asesor_evidencia = allowlist + octet-stream.';

REVOKE ALL ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expediente_documento_mime_permitido(TEXT, TEXT)
  TO authenticated, service_role, postgres;
