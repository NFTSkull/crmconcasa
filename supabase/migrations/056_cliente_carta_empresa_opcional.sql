-- ConCasa CRM — Documento opcional asesor: Cliente · Carta de la empresa (foráneos)
-- No altera gate obligatorio (4/4) ni complementarios Mesa.

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_opcionales()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_semanas_cotizadas',
    'cliente_carta_empresa'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_opcionales() IS
  'P056: tipos opcionales de upload asesor (no bloquean enviar_a_mesa). Incluye semanas cotizadas y carta de la empresa.';

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload() IS
  'P056: tipos permitidos para upload/register asesor (4 oblig + 2 opcionales = 6). Excluye acta/constancia SAT (Mesa).';
