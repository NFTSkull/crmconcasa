import {
  CLIENTE_PAGARE_DOCUMENT_CONTRACT,
  CLIENTE_PAGARE_DOCUMENT_TIPO,
} from "./integration-docs-completos";
import {
  buildExpedienteDocumentoStoragePath,
  storageObjectKeyLooksSafe,
} from "./storage-path";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";

export type ClientePagareMime =
  (typeof CLIENTE_PAGARE_DOCUMENT_CONTRACT.mimePermitidos)[number];

export type ClientePagareDocumento = Readonly<{
  id: string;
  expedienteId: string;
  tipoDocumento: typeof CLIENTE_PAGARE_DOCUMENT_TIPO;
  fileName: string;
  storagePath: string | null;
  mimeType: ClientePagareMime | string;
  fileSize: number | null;
  version: number;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
}>;

export const CLIENTE_PAGARE_ACCEPT_ATTR =
  ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

const EXT_BY_MIME: Readonly<Record<ClientePagareMime, readonly string[]>> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
};

function fileNameOf(file: File): string {
  return String(file.name ?? "").trim();
}

function normalizeMime(raw: string): string {
  const m = raw.toLowerCase().trim().split(";")[0] ?? "";
  if (m === "image/jpg") return "image/jpeg";
  return m;
}

function inferMimeFromName(name: string): ClientePagareMime | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  return null;
}

function extensionMatchesMime(name: string, mime: ClientePagareMime): boolean {
  const exts = EXT_BY_MIME[mime];
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

export function isClientePagareMime(value: string): value is ClientePagareMime {
  return (CLIENTE_PAGARE_DOCUMENT_CONTRACT.mimePermitidos as readonly string[]).includes(
    value,
  );
}

/** Resuelve MIME canónico para Storage/RPC. */
export function resolveClientePagareUploadMime(file: File): ClientePagareMime | null {
  const name = fileNameOf(file);
  const raw = normalizeMime(file.type || "");
  if (raw === "application/pdf" || raw === "application/x-pdf") {
    if (name && !extensionMatchesMime(name, "application/pdf") && !name.toLowerCase().endsWith(".pdf")) {
      return null;
    }
    return "application/pdf";
  }
  if (raw === "image/jpeg" || raw === "image/png") {
    if (name && !extensionMatchesMime(name, raw)) return null;
    return raw;
  }
  // octet-stream / vacío: solo por extensión estricta
  if (!raw || raw === "application/octet-stream") {
    return inferMimeFromName(name);
  }
  return null;
}

export type ValidateClientePagareFileResult =
  | Readonly<{ ok: true; mime: ClientePagareMime }>
  | Readonly<{ ok: false; error: string }>;

export function validateClientePagareFile(
  file: File | null | undefined,
): ValidateClientePagareFileResult {
  if (!file) {
    return { ok: false, error: "Selecciona un archivo PDF, JPG, JPEG o PNG." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (file.size > CLIENTE_PAGARE_DOCUMENT_CONTRACT.maxBytes) {
    return { ok: false, error: "El archivo supera el límite de 15 MB." };
  }

  const name = fileNameOf(file);
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    return { ok: false, error: "Selecciona un archivo PDF, JPG, JPEG o PNG." };
  }

  const rawMime = normalizeMime(file.type || "");
  if (!rawMime) {
    return { ok: false, error: "Selecciona un archivo PDF, JPG, JPEG o PNG." };
  }

  const mime = resolveClientePagareUploadMime(file);
  if (!mime) {
    if (inferMimeFromName(name) && rawMime !== inferMimeFromName(name) && rawMime !== "application/octet-stream") {
      return {
        ok: false,
        error: "El formato del archivo no coincide con su extensión.",
      };
    }
    return { ok: false, error: "Selecciona un archivo PDF, JPG, JPEG o PNG." };
  }

  if (!extensionMatchesMime(name, mime)) {
    return {
      ok: false,
      error: "El formato del archivo no coincide con su extensión.",
    };
  }

  return { ok: true, mime };
}

export function buildClientePagareStoragePath(input: Readonly<{
  organizationId: string;
  expedienteId: string;
  mimeType: ClientePagareMime;
  originalFileName?: string | null;
}>): string {
  const path = buildExpedienteDocumentoStoragePath({
    organizationId: input.organizationId,
    expedienteId: input.expedienteId,
    tipoDocumento: CLIENTE_PAGARE_DOCUMENT_TIPO,
    mimeType: input.mimeType,
    originalFileName: input.originalFileName,
  });
  if (!path.includes(`/${CLIENTE_PAGARE_DOCUMENT_TIPO}/`)) {
    throw new Error("path Pagaré inválido");
  }
  if (!storageObjectKeyLooksSafe(path)) {
    throw new Error("object key Pagaré inseguro");
  }
  return path;
}

export function formatBytesLabel(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 1)} MB`;
}

export function formatPagareMimeLabel(mime: string | null | undefined): string {
  const m = (mime ?? "").toLowerCase();
  if (m === "application/pdf") return "PDF";
  if (m === "image/jpeg") return "JPEG";
  if (m === "image/png") return "PNG";
  return "Archivo";
}

export function shouldShowAsesorPagareSection(etapaActual: number | null | undefined): boolean {
  return typeof etapaActual === "number" && etapaActual >= 7;
}

export function canMesaOperatePagare(input: Readonly<{
  etapaActual: number | null | undefined;
  puedeOperar: boolean;
}>): boolean {
  return (
    input.puedeOperar &&
    typeof input.etapaActual === "number" &&
    input.etapaActual >= CLIENTE_PAGARE_DOCUMENT_CONTRACT.etapaMinima
  );
}

/** Extrae Pagaré vigente de listado activo (RLS ya filtra deleted_at). */
export function findClientePagareFromList(
  items: readonly ExpedienteArchivoListItem[],
): ClientePagareDocumento | null {
  const found = items.find((i) => i.tipo_documento === CLIENTE_PAGARE_DOCUMENT_TIPO);
  if (!found) return null;
  return {
    id: found.id,
    expedienteId: found.expediente_id,
    tipoDocumento: CLIENTE_PAGARE_DOCUMENT_TIPO,
    fileName: found.nombre_original,
    storagePath: null,
    mimeType: found.mime_type,
    fileSize: found.size_bytes,
    version: found.version ?? 1,
    createdAt: found.created_at,
    createdBy: null,
    createdByName:
      found.uploaded_by_name?.trim() || found.uploaded_by_email?.trim() || null,
  };
}

export type MesaPagareUiMode =
  | "etapa_bloqueada"
  | "pendiente"
  | "cargado"
  | "solo_lectura";

export function resolveMesaPagareUiMode(input: Readonly<{
  etapaActual: number | null | undefined;
  puedeOperar: boolean;
  hasDocumento: boolean;
}>): MesaPagareUiMode {
  if (
    typeof input.etapaActual !== "number" ||
    input.etapaActual < CLIENTE_PAGARE_DOCUMENT_CONTRACT.etapaMinima
  ) {
    return "etapa_bloqueada";
  }
  if (!input.puedeOperar) {
    return input.hasDocumento ? "solo_lectura" : "pendiente";
  }
  return input.hasDocumento ? "cargado" : "pendiente";
}

export function mesaPagareWriteEnabled(mode: MesaPagareUiMode): boolean {
  return mode === "pendiente" || mode === "cargado";
}
