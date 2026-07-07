export const ALLOWED_UPLOAD_MIME_TYPES = ["application/pdf"] as const;

export const ALLOWED_UPLOAD_EXTENSIONS = [".pdf"] as const;

export const ALLOWED_INE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const INE_IMAGE_DOCUMENT_TIPOS = new Set([
  "cliente_ine_frente",
  "cliente_ine_reverso",
]);

export const CARTA_EMPRESA_DOCUMENT_TIPO = "cliente_carta_empresa";

export const PDF_OR_IMAGE_DOCUMENT_TIPOS = new Set([
  ...INE_IMAGE_DOCUMENT_TIPOS,
  CARTA_EMPRESA_DOCUMENT_TIPO,
]);

const INE_IMAGE_EXTENSIONS_BY_MIME: Record<string, readonly string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
};

export const EXPEDIENTE_DOCUMENTO_PDF_ACCEPT_ATTR = "application/pdf,.pdf";

export const EXPEDIENTE_DOCUMENTO_INE_ACCEPT_ATTR =
  "application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp,image/heic,.heic,image/heif,.heif";

export const PDF_ONLY_UPLOAD_MESSAGE =
  "Solo se permiten archivos PDF. Convierte el documento a PDF antes de subirlo.";

export const INE_IMAGE_UPLOAD_MESSAGE =
  "Para INE puedes subir PDF o imagen (JPG, PNG, WEBP, HEIC).";

export const PDF_OR_IMAGE_UPLOAD_MESSAGE =
  "Puedes subir PDF o imagen (JPG, PNG, WEBP, HEIC).";

function fileName(file: File): string {
  return String(file.name ?? "").trim();
}

function hasPdfExtension(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

function hasImageExtension(name: string, mime: string): boolean {
  const exts = INE_IMAGE_EXTENSIONS_BY_MIME[mime];
  if (!exts?.length) return true;
  const lower = name.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

function isAllowedImageMime(mime: string): boolean {
  return ALLOWED_INE_IMAGE_MIME_TYPES.includes(
    mime as (typeof ALLOWED_INE_IMAGE_MIME_TYPES)[number],
  );
}

function inferImageMimeFromExtension(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  return null;
}

function resolveImageMimeForUpload(file: File): string | null {
  const raw = (file.type || "").toLowerCase().trim();
  if (raw && raw !== "application/octet-stream" && isAllowedImageMime(raw)) {
    return raw;
  }
  const inferred = inferImageMimeFromExtension(fileName(file));
  if (inferred) return inferred;
  return null;
}

export function isIneImageDocumentTipo(tipoDocumento?: string | null): boolean {
  return INE_IMAGE_DOCUMENT_TIPOS.has(String(tipoDocumento ?? "").trim());
}

export function isCartaEmpresaDocumentTipo(tipoDocumento?: string | null): boolean {
  return String(tipoDocumento ?? "").trim() === CARTA_EMPRESA_DOCUMENT_TIPO;
}

export function isPdfOrImageDocumentTipo(tipoDocumento?: string | null): boolean {
  return PDF_OR_IMAGE_DOCUMENT_TIPOS.has(String(tipoDocumento ?? "").trim());
}

export function getExpedienteDocumentoAcceptAttr(
  tipoDocumento?: string | null,
): string {
  return isPdfOrImageDocumentTipo(tipoDocumento)
    ? EXPEDIENTE_DOCUMENTO_INE_ACCEPT_ATTR
    : EXPEDIENTE_DOCUMENTO_PDF_ACCEPT_ATTR;
}

function isPdfMime(mime: string): boolean {
  const m = mime.toLowerCase().trim();
  return m === "application/pdf" || m === "application/x-pdf" || m === "application/vnd.pdf";
}

const CONFLICTING_NON_PDF_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".doc",
  ".docx",
] as const;

function hasConflictingNonPdfExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return CONFLICTING_NON_PDF_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** PDF reconocible por MIME canónico o por extensión `.pdf` (p. ej. `application/octet-stream`, `text/plain`). */
export function isPdfLikeFile(file: File): boolean {
  if (!file || file.size <= 0) return false;
  const mime = (file.type || "").toLowerCase().trim();
  const name = fileName(file);
  if (hasPdfExtension(name)) {
    if (mime.startsWith("image/")) return false;
    return true;
  }
  if (isPdfMime(mime)) {
    return !hasConflictingNonPdfExtension(name);
  }
  return false;
}

function normalizeUploadMime(mime: string): string {
  if (mime === "image/jpg") return "image/jpeg";
  return mime;
}

/** MIME a enviar a Storage/RPC; normaliza PDFs e imágenes con tipo vacío u octet-stream. */
export function resolveExpedienteDocumentoUploadMime(
  file: File,
  tipoDocumento?: string | null,
): string {
  if (isPdfLikeFile(file)) return "application/pdf";
  if (isPdfOrImageDocumentTipo(tipoDocumento)) {
    const imageMime = resolveImageMimeForUpload(file);
    if (imageMime) return normalizeUploadMime(imageMime);
  }
  const raw = normalizeUploadMime((file.type || "").toLowerCase().trim());
  return raw;
}

/** @deprecated Usar `isPdfLikeFile`. */
export function isPdfFile(file: File): boolean {
  return isPdfLikeFile(file);
}

export function validatePdfFile(
  file: File | null | undefined,
): { ok: true } | { ok: false; message: string } {
  if (!file || file.size <= 0) {
    return { ok: false, message: "Selecciona un archivo válido." };
  }

  const name = fileName(file);

  if (isPdfLikeFile(file)) {
    return { ok: true };
  }

  if (name) {
    return {
      ok: false,
      message: `"${name}" no es válido. Solo se permiten archivos PDF.`,
    };
  }
  return { ok: false, message: PDF_ONLY_UPLOAD_MESSAGE };
}

function validatePdfOrImageFile(
  file: File,
): { ok: true } | { ok: false; message: string } {
  const pdfValidation = validatePdfFile(file);
  if (pdfValidation.ok) return pdfValidation;

  const name = fileName(file);
  const imageMime = resolveImageMimeForUpload(file);

  if (imageMime) {
    if (!hasImageExtension(name, imageMime)) {
      return {
        ok: false,
        message: `"${name}" no es válido. La extensión no coincide con el tipo de imagen.`,
      };
    }
    return { ok: true };
  }

  if (name) {
    return {
      ok: false,
      message: `"${name}" no es válido. ${PDF_OR_IMAGE_UPLOAD_MESSAGE}`,
    };
  }
  return { ok: false, message: PDF_OR_IMAGE_UPLOAD_MESSAGE };
}

export function validateExpedienteDocumentoUploadFile(
  file: File | null | undefined,
  tipoDocumento?: string | null,
): { ok: true } | { ok: false; message: string } {
  if (!file || file.size <= 0) {
    return { ok: false, message: "Selecciona un archivo válido." };
  }
  if (isPdfOrImageDocumentTipo(tipoDocumento)) {
    return validatePdfOrImageFile(file);
  }
  return validatePdfFile(file);
}

export function formatPdfUploadRejectionForField(
  fieldLabel: string,
  file: File,
): string {
  const validation = validatePdfFile(file);
  if (validation.ok) return "";
  const name = fileName(file);
  if (name) {
    return `"${name}" no es válido. ${fieldLabel} debe subirse en formato PDF.`;
  }
  return `${fieldLabel} debe subirse en formato PDF.`;
}

export function formatExpedienteDocumentoUploadRejection(
  fieldLabel: string,
  file: File,
  tipoDocumento?: string | null,
): string {
  const validation = validateExpedienteDocumentoUploadFile(file, tipoDocumento);
  if (validation.ok) return "";
  const name = fileName(file);
  if (isPdfOrImageDocumentTipo(tipoDocumento)) {
    if (name) {
      return `"${name}" no es válido. ${fieldLabel}: ${PDF_OR_IMAGE_UPLOAD_MESSAGE}`;
    }
    return `${fieldLabel}: ${PDF_OR_IMAGE_UPLOAD_MESSAGE}`;
  }
  return formatPdfUploadRejectionForField(fieldLabel, file);
}
