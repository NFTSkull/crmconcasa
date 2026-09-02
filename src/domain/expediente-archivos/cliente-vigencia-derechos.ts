import {
  CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT,
  CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
} from "./integration-docs-completos";
import {
  buildExpedienteDocumentoStoragePath,
  storageObjectKeyLooksSafe,
} from "./storage-path";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";

export type ClienteVigenciaDerechosDocumento = Readonly<{
  id: string;
  expedienteId: string;
  tipoDocumento: typeof CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO;
  fileName: string;
  storagePath: string | null;
  mimeType: string;
  fileSize: number | null;
  version: number;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
}>;

export const CLIENTE_VIGENCIA_DERECHOS_ACCEPT_ATTR = "*/*";

export const CLIENTE_VIGENCIA_DERECHOS_UPLOAD_HINT =
  "Documento opcional. Puedes subir cualquier formato (máx. 15 MB).";

/** MIME permitidos en RPC/Storage para `cliente_vigencia_derechos` (espejo evidencia). */
export const CLIENTE_VIGENCIA_DERECHOS_MIME_PERMITIDOS = [
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

const CLIENTE_VIGENCIA_DERECHOS_MIME_SET = new Set<string>(
  CLIENTE_VIGENCIA_DERECHOS_MIME_PERMITIDOS,
);

/** MIME seguros para vista previa inline (PDF + imágenes raster comunes). */
const PREVIEWABLE_VIGENCIA_DERECHOS_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isClienteVigenciaDerechosTipo(tipo: string | null | undefined): boolean {
  return String(tipo ?? "").trim() === CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO;
}

/** MIME canónico para upload: allowlist o `application/octet-stream`. */
export function resolveClienteVigenciaDerechosUploadMime(file: File): string {
  const raw = String(file.type ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0];
  const normalized = raw === "image/jpg" ? "image/jpeg" : raw;
  if (normalized && CLIENTE_VIGENCIA_DERECHOS_MIME_SET.has(normalized)) {
    return normalized;
  }
  return "application/octet-stream";
}

export type ValidateClienteVigenciaDerechosFileResult =
  | Readonly<{ ok: true; mime: string }>
  | Readonly<{ ok: false; error: string }>;

export function validateClienteVigenciaDerechosFile(
  file: File | null | undefined,
): ValidateClienteVigenciaDerechosFileResult {
  if (!file) {
    return { ok: false, error: "Selecciona un archivo para vigencia de derechos." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (file.size > CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT.maxBytes) {
    return {
      ok: false,
      error: `El archivo no puede superar ${CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT.maxBytes / (1024 * 1024)} MB.`,
    };
  }
  return { ok: true, mime: resolveClienteVigenciaDerechosUploadMime(file) };
}

/** Solo PDF/JPG/PNG/WEBP — nunca HTML/SVG/Office/binarios. */
export function isClienteVigenciaDerechosPreviewableMime(
  mime: string | null | undefined,
): boolean {
  const m = String(mime ?? "")
    .toLowerCase()
    .trim()
    .split(";")[0];
  if (!m) return false;
  if (m === "image/svg+xml" || m === "text/html" || m === "application/xhtml+xml") {
    return false;
  }
  return PREVIEWABLE_VIGENCIA_DERECHOS_MIMES.has(m);
}

export function findClienteVigenciaDerechosFromList(
  list: readonly ExpedienteArchivoListItem[],
): ClienteVigenciaDerechosDocumento | null {
  const row = list.find((d) => d.tipo_documento === CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO);
  if (!row) return null;
  return {
    id: row.id,
    expedienteId: row.expediente_id,
    tipoDocumento: CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
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

export function buildClienteVigenciaDerechosStoragePath(input: Readonly<{
  organizationId: string;
  expedienteId: string;
  mimeType: string;
  originalFileName?: string | null;
}>): string {
  const path = buildExpedienteDocumentoStoragePath({
    organizationId: input.organizationId,
    expedienteId: input.expedienteId,
    tipoDocumento: CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
    mimeType: input.mimeType,
    originalFileName: input.originalFileName,
  });
  if (!storageObjectKeyLooksSafe(path)) {
    throw new Error("Path de vigencia de derechos inseguro");
  }
  return path;
}

export function sanitizeVigenciaDerechosDisplayName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  const noSlashes = trimmed.replace(/[/\\]+/g, "_");
  const cleaned = noSlashes.replace(/^\.+/, "").slice(0, 160);
  return cleaned || "vigencia_derechos";
}

/** La tarjeta Vigencia de derechos se muestra con expediente cargado; no depende de fila previa. */
export function shouldMountAsesorVigenciaDerechosSection(
  expedienteId: string | null | undefined,
): boolean {
  return Boolean(String(expedienteId ?? "").trim());
}

/**
 * Permiso de carga/reemplazo de Vigencia de derechos (independiente de monto/Pagaré/cobro).
 * Espejo FE de `register_expediente_documento`: ciclo activo (dueño lo valida el RPC).
 */
export function asesorPuedeEditarVigenciaDerechos(
  cicloEstado: string | null | undefined,
): boolean {
  const ciclo = String(cicloEstado ?? "activo")
    .trim()
    .toLowerCase();
  return ciclo === "activo";
}

export { formatBytesLabel } from "./cliente-pagare";
