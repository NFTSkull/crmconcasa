import type { EstatusRevision, TipoDocumentoCatalogo } from "./types";
import { TIPO_DOCUMENTO_CATALOGO } from "./types";

export type SupabaseExpedienteDocumentoRow = {
  id: string;
  expediente_id: string;
  tipo_documento: string;
  nombre_original: string;
  mime_type: string;
  size_bytes: number;
  estatus_revision: string;
  comentario_mesa: string | null;
  uploaded_by_role: string;
  created_at: string;
  uploaded_by_profile?: { email?: string | null } | null;
};

export type ExpedienteArchivoListItem = {
  expediente_id: string;
  tipo_documento: TipoDocumentoCatalogo;
  id: string;
  nombre_original: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_role: string;
  uploaded_by_email: string;
  estatus_revision: EstatusRevision;
  comentario_mesa: string | null;
};

function ensureTipoDocumentoCatalogo(value: string): TipoDocumentoCatalogo | null {
  return (TIPO_DOCUMENTO_CATALOGO as readonly string[]).includes(value)
    ? (value as TipoDocumentoCatalogo)
    : null;
}

function normalizeEstatusRevision(value: unknown): EstatusRevision {
  if (
    value === "subido" ||
    value === "validado" ||
    value === "rechazado" ||
    value === "resubido"
  ) {
    return value;
  }
  return "subido";
}

/**
 * Mapea fila Supabase a ítem de lista del dominio.
 * Retorna `null` si `tipo_documento` no está en el catálogo frontend.
 */
export function mapSupabaseRowToExpedienteArchivoListItem(
  row: SupabaseExpedienteDocumentoRow,
): ExpedienteArchivoListItem | null {
  const tipo = ensureTipoDocumentoCatalogo(row.tipo_documento);
  if (!tipo) return null;

  return {
    expediente_id: row.expediente_id,
    tipo_documento: tipo,
    id: row.id,
    nombre_original: row.nombre_original,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    uploaded_by_role: row.uploaded_by_role,
    uploaded_by_email: row.uploaded_by_profile?.email?.trim() || "asesor",
    estatus_revision: normalizeEstatusRevision(row.estatus_revision),
    comentario_mesa: row.comentario_mesa,
  };
}
