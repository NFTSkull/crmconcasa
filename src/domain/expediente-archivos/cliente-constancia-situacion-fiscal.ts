/**
 * Constancia de Situación Fiscal (SAT) — opcional asesor.
 * Tipo canónico: `cliente_constancia_situacion_fiscal` (≠ Mesa `cliente_constancia_sat`).
 * PDF ≤15 MiB; sin gate.
 */
import {
  CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT,
  CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
} from "./integration-docs-completos";
import {
  buildExpedienteDocumentoStoragePath,
  storageObjectKeyLooksSafe,
} from "./storage-path";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";

export type ClienteConstanciaSituacionFiscalDocumento = Readonly<{
  id: string;
  expedienteId: string;
  tipoDocumento: typeof CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO;
  fileName: string;
  storagePath: string | null;
  mimeType: string;
  fileSize: number | null;
  version: number;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
}>;

export const CLIENTE_CONSTANCIA_SITUACION_FISCAL_ACCEPT_ATTR =
  "application/pdf,.pdf";

export const CLIENTE_CONSTANCIA_SITUACION_FISCAL_UPLOAD_HINT =
  "Documento opcional. Sube la Constancia de Situación Fiscal en PDF (máx. 15 MB).";

export function isClienteConstanciaSituacionFiscalTipo(
  tipo: string | null | undefined,
): boolean {
  return (
    String(tipo ?? "").trim() === CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO
  );
}

export function isClienteConstanciaSituacionFiscalPreviewableMime(
  mime: string | null | undefined,
): boolean {
  const m = String(mime ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0];
  return m === "application/pdf" || m === "application/x-pdf";
}

export type ValidateClienteConstanciaSituacionFiscalFileResult =
  | Readonly<{ ok: true; mime: string }>
  | Readonly<{ ok: false; error: string }>;

export function validateClienteConstanciaSituacionFiscalFile(
  file: File | null | undefined,
): ValidateClienteConstanciaSituacionFiscalFileResult {
  if (!file) {
    return { ok: false, error: "Selecciona un archivo para Constancia SAT." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (file.size > CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT.maxBytes) {
    return {
      ok: false,
      error: `El archivo no puede superar ${CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT.maxBytes / (1024 * 1024)} MB.`,
    };
  }
  const name = String(file.name ?? "").toLowerCase();
  const mime = String(file.type ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0];
  const looksPdf =
    mime === "application/pdf" ||
    mime === "application/x-pdf" ||
    name.endsWith(".pdf");
  if (!looksPdf) {
    return { ok: false, error: "Solo se permiten archivos PDF." };
  }
  return { ok: true, mime: "application/pdf" };
}

export function findClienteConstanciaSituacionFiscalFromList(
  list: readonly ExpedienteArchivoListItem[],
): ClienteConstanciaSituacionFiscalDocumento | null {
  const row = list.find(
    (d) => d.tipo_documento === CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
  );
  if (!row) return null;
  return {
    id: row.id,
    expedienteId: row.expediente_id,
    tipoDocumento: CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
    fileName: row.nombre_original,
    storagePath: null,
    mimeType: row.mime_type,
    fileSize: row.size_bytes,
    version: row.version,
    createdAt: row.created_at,
    createdBy: null,
    createdByName: row.uploaded_by_name,
  };
}

export function buildClienteConstanciaSituacionFiscalStoragePath(input: Readonly<{
  organizationId: string;
  expedienteId: string;
  mimeType?: string;
  originalFileName?: string | null;
}>): string {
  const path = buildExpedienteDocumentoStoragePath({
    organizationId: input.organizationId,
    expedienteId: input.expedienteId,
    tipoDocumento: CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
    mimeType: input.mimeType ?? "application/pdf",
    originalFileName: input.originalFileName,
  });
  if (!storageObjectKeyLooksSafe(path)) {
    throw new Error("Path de Constancia SAT inseguro");
  }
  return path;
}

export function sanitizeConstanciaSituacionFiscalDisplayName(
  name: string | null | undefined,
): string {
  const trimmed = String(name ?? "").trim();
  const noSlashes = trimmed.replace(/[/\\]+/g, "_");
  const cleaned = noSlashes.replace(/^\.+/, "").slice(0, 160);
  return cleaned || "constancia-sat.pdf";
}

export function shouldMountAsesorConstanciaSituacionFiscalSection(
  expedienteId: string | null | undefined,
): boolean {
  return Boolean(String(expedienteId ?? "").trim());
}

/** Misma regla que Vigencia/Evidencia: ciclo activo. */
export function asesorPuedeEditarConstanciaSituacionFiscal(
  cicloEstado: string | null | undefined,
): boolean {
  const ciclo = String(cicloEstado ?? "activo")
    .trim()
    .toLowerCase();
  return ciclo === "activo";
}

export { formatBytesLabel } from "./cliente-pagare";
