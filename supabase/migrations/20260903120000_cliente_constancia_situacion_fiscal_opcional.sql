-- ConCasa CRM — Documento opcional asesor «Constancia de Situación Fiscal (SAT)»
-- tipo canónico: cliente_constancia_situacion_fiscal
-- Distinto de Mesa cliente_constancia_sat (intacto; no se toca mesa_upload ni MIME especial).
-- PDF genérico vía expediente_documento_mime_permitido (sin rama nueva).
-- NO gate, NO obligatorio, NO Mesa upload. P208 vía allowlist opcionales (sin tocar helpers).
-- Cloud max al escribir: post 20260902212527. Cardinalidad opc 9 / upload 13.

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
    'cliente_vigencia_derechos',
    'cliente_constancia_situacion_fiscal'
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
  'Allowlist opcionales asesor; + cliente_constancia_situacion_fiscal (PDF ≤15 MiB; no gate; ≠ cliente_constancia_sat).';

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload() IS
  'Tipos permitidos upload/register asesor (4 oblig + opcionales incl. Constancia SAT asesor).';
