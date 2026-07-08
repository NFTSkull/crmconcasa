import type { IntegrationDocAsesorEnvioTipo } from "./integration-docs-completos";

export type BuildExpedienteDocumentoStoragePathInput = {
  organizationId: string;
  expedienteId: string;
  tipoDocumento: IntegrationDocAsesorEnvioTipo | string;
  /** MIME normalizado del upload (preferido para extensión). */
  mimeType?: string | null;
  /** Solo para inferir extensión; no se usa en el path Storage. */
  originalFileName?: string | null;
};

const MIME_TO_STORAGE_EXT: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

/** Infiere extensión segura para object key de Storage. */
export function inferStorageFileExtension(
  mimeType: string | null | undefined,
  originalFileName?: string | null,
): string {
  const mime = String(mimeType ?? "")
    .trim()
    .toLowerCase()
    .split(";")[0];
  if (mime && MIME_TO_STORAGE_EXT[mime]) {
    return MIME_TO_STORAGE_EXT[mime];
  }

  const name = String(originalFileName ?? "").trim();
  const dot = name.lastIndexOf(".");
  if (dot >= 0 && dot < name.length - 1) {
    const raw = name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (raw) {
      if (raw === "jpeg") return "jpg";
      if (raw.length <= 8) return raw;
    }
  }

  return "bin";
}

/**
 * Sanitiza nombre de archivo (legacy / display). No usar como segmento de Storage key.
 * @deprecated El path Storage usa UUID + extensión; conservar solo si hace falta en UI.
 */
export function sanitizeExpedienteDocumentoFileName(originalFileName: string): string {
  const trimmed = String(originalFileName ?? "").trim();
  const noSlashes = trimmed.replace(/[/\\]+/g, "_");
  const noLeadingDots = noSlashes.replace(/^\.+/, "");
  const cleaned = noLeadingDots
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  if (!cleaned || /^-+$/.test(cleaned)) {
    return "archivo";
  }
  return cleaned;
}

/**
 * Path Storage: `{organization_id}/{expediente_id}/{tipo_documento}/{uuid}.{ext}`
 * El nombre original del usuario va en `p_nombre_original` del RPC, no en la key.
 */
export function buildExpedienteDocumentoStoragePath(
  input: BuildExpedienteDocumentoStoragePathInput,
): string {
  const org = String(input.organizationId).trim();
  const exp = String(input.expedienteId).trim();
  const tipo = String(input.tipoDocumento).trim();
  if (!org || !exp || !tipo) {
    throw new Error("buildExpedienteDocumentoStoragePath: faltan organizationId, expedienteId o tipo");
  }
  const ext = inferStorageFileExtension(input.mimeType, input.originalFileName);
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `tmp-${Date.now()}`;
  return `${org}/${exp}/${tipo}/${uuid}.${ext}`;
}

/** Segmento final del path sin espacios ni paréntesis (tests / validación). */
export function storageObjectKeyLooksSafe(storagePath: string): boolean {
  const segment = storagePath.split("/").pop() ?? "";
  return (
    /^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(segment) ||
    /^tmp-\d+\.[a-z0-9]+$/i.test(segment)
  );
}
