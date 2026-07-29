import {
  ASESOR_EVIDENCIA_DOCUMENT_CONTRACT,
  ASESOR_EVIDENCIA_DOCUMENT_TIPO,
} from "./integration-docs-completos";
import {
  buildExpedienteDocumentoStoragePath,
  storageObjectKeyLooksSafe,
} from "./storage-path";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";

export type AsesorEvidenciaDocumento = Readonly<{
  id: string;
  expedienteId: string;
  tipoDocumento: typeof ASESOR_EVIDENCIA_DOCUMENT_TIPO;
  fileName: string;
  storagePath: string | null;
  mimeType: string;
  fileSize: number | null;
  version: number;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
}>;

export const ASESOR_EVIDENCIA_ACCEPT_ATTR = "*/*";

export const ASESOR_EVIDENCIA_UPLOAD_HINT =
  "Documento opcional. Puedes subir cualquier formato (máx. 15 MB).";

/** MIME permitidos en RPC/Storage para `asesor_evidencia` (espejo mig. 128). */
export const ASESOR_EVIDENCIA_MIME_PERMITIDOS = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
  "application/zip",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream",
] as const;

const ASESOR_EVIDENCIA_MIME_SET = new Set<string>(ASESOR_EVIDENCIA_MIME_PERMITIDOS);

/** MIME seguros para vista previa inline (PDF + imágenes raster comunes). */
const PREVIEWABLE_EVIDENCIA_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isAsesorEvidenciaTipo(tipo: string | null | undefined): boolean {
  return String(tipo ?? "").trim() === ASESOR_EVIDENCIA_DOCUMENT_TIPO;
}

/** MIME canónico para upload: allowlist o `application/octet-stream`. */
export function resolveAsesorEvidenciaUploadMime(file: File): string {
  const raw = String(file.type ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0];
  const normalized = raw === "image/jpg" ? "image/jpeg" : raw;
  if (normalized && ASESOR_EVIDENCIA_MIME_SET.has(normalized)) {
    return normalized;
  }
  return "application/octet-stream";
}

export type ValidateAsesorEvidenciaFileResult =
  | Readonly<{ ok: true; mime: string }>
  | Readonly<{ ok: false; error: string }>;

export function validateAsesorEvidenciaFile(
  file: File | null | undefined,
): ValidateAsesorEvidenciaFileResult {
  if (!file) {
    return { ok: false, error: "Selecciona un archivo para la evidencia." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (file.size > ASESOR_EVIDENCIA_DOCUMENT_CONTRACT.maxBytes) {
    return {
      ok: false,
      error: `El archivo no puede superar ${ASESOR_EVIDENCIA_DOCUMENT_CONTRACT.maxBytes / (1024 * 1024)} MB.`,
    };
  }
  return { ok: true, mime: resolveAsesorEvidenciaUploadMime(file) };
}

/** Solo PDF/JPG/PNG/WEBP — nunca HTML/SVG/Office/binarios. */
export function isAsesorEvidenciaPreviewableMime(mime: string | null | undefined): boolean {
  const m = String(mime ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0];
  if (!m) return false;
  if (m === "image/svg+xml" || m === "text/html" || m === "application/xhtml+xml") {
    return false;
  }
  return PREVIEWABLE_EVIDENCIA_MIMES.has(m);
}

export function findAsesorEvidenciaFromList(
  list: readonly ExpedienteArchivoListItem[],
): AsesorEvidenciaDocumento | null {
  const row = list.find((d) => d.tipo_documento === ASESOR_EVIDENCIA_DOCUMENT_TIPO);
  if (!row) return null;
  return {
    id: row.id,
    expedienteId: row.expediente_id,
    tipoDocumento: ASESOR_EVIDENCIA_DOCUMENT_TIPO,
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

export function buildAsesorEvidenciaStoragePath(input: Readonly<{
  organizationId: string;
  expedienteId: string;
  mimeType: string;
  originalFileName?: string | null;
}>): string {
  const path = buildExpedienteDocumentoStoragePath({
    organizationId: input.organizationId,
    expedienteId: input.expedienteId,
    tipoDocumento: ASESOR_EVIDENCIA_DOCUMENT_TIPO,
    mimeType: input.mimeType,
    originalFileName: input.originalFileName,
  });
  if (!storageObjectKeyLooksSafe(path)) {
    throw new Error("Path de evidencia inseguro");
  }
  return path;
}

export function sanitizeEvidenciaDisplayName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  const noSlashes = trimmed.replace(/[/\\]+/g, "_");
  const cleaned = noSlashes.replace(/^\.+/, "").slice(0, 160);
  return cleaned || "evidencia";
}

/** La tarjeta Evidencia se muestra con expediente cargado; no depende de fila previa. */
export function shouldMountAsesorEvidenciaSection(
  expedienteId: string | null | undefined,
): boolean {
  return Boolean(String(expedienteId ?? "").trim());
}

/**
 * Permiso de carga/reemplazo de Evidencia (independiente de monto/Pagaré/cobro).
 * Espejo FE de `register_expediente_documento`: ciclo activo (dueño lo valida el RPC).
 */
export function asesorPuedeEditarEvidencia(
  cicloEstado: string | null | undefined,
): boolean {
  const ciclo = String(cicloEstado ?? "activo")
    .trim()
    .toLowerCase();
  return ciclo === "activo";
}

export { formatBytesLabel } from "./cliente-pagare";
