-- ConCasa CRM — Documentos obligatorios por rol
-- Quitar archivo NSS del gate asesor/Mesa; acta y constancia SAT siguen solo en integration_doc_tipos_mesa_upload (030).
-- El campo NSS del cliente (cliente_datos / expedientes.nss) no cambia.

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_envio()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_ine_frente',
    'cliente_ine_reverso',
    'cliente_comprobante_domicilio',
    'cliente_estado_cuenta'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_envio() IS
  'P044: tipos obligatorios que el asesor debe subir antes de enviar_a_mesa (4). Sin archivo nss (dato en cliente_datos). Excluye acta/constancia SAT (Mesa).';

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload() IS
  'P044: tipos permitidos para upload/register asesor (4 oblig + 1 opcional semanas = 5). Excluye nss, acta y constancia SAT.';

COMMENT ON FUNCTION public.integration_doc_tipos_obligatorios() IS
  'P044: validación Mesa y avance 1→2 — 4 documentos del asesor validados. Complementarios Mesa (semanas/acta/SAT) opcionales.';

COMMENT ON FUNCTION public.count_integration_docs_presentes(UUID) IS
  'Cuenta documentos presentes de integration_doc_tipos_asesor_envio (lista de 4).';

COMMENT ON FUNCTION public.integration_docs_completos(UUID) IS
  'true si los 4 documentos de integration_doc_tipos_asesor_envio están presentes.';

COMMENT ON FUNCTION public.count_integration_docs_validados(UUID) IS
  'Cuenta documentos validados de integration_doc_tipos_obligatorios (lista de 4).';

COMMENT ON FUNCTION public.integration_docs_todos_validados(UUID) IS
  'true si los 4 documentos de integration_doc_tipos_obligatorios están validados.';
