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

export function isIneImageDocumentTipo(tipoDocumento?: string | null): boolean {
  return INE_IMAGE_DOCUMENT_TIPOS.has(String(tipoDocumento ?? "").trim());
}

export function getExpedienteDocumentoAcceptAttr(
  tipoDocumento?: string | null,
): string {
  return isIneImageDocumentTipo(tipoDocumento)
    ? EXPEDIENTE_DOCUMENTO_INE_ACCEPT_ATTR
    : EXPEDIENTE_DOCUMENTO_PDF_ACCEPT_ATTR;
}

/** true si MIME y extensión son PDF. */
export function isPdfFile(file: File): boolean {
  if (!file || file.size <= 0) return false;
  const mime = (file.type || "").toLowerCase().trim();
  return mime === "application/pdf" && hasPdfExtension(fileName(file));
}

export function validatePdfFile(
  file: File | null | undefined,
): { ok: true } | { ok: false; message: string } {
  if (!file || file.size <= 0) {
    return { ok: false, message: "Selecciona un archivo válido." };
  }

  const mime = (file.type || "").toLowerCase().trim();
  const name = fileName(file);
  const extOk = hasPdfExtension(name);
  const mimeOk = mime === "application/pdf";

  if (!mimeOk || !extOk) {
    if (name) {
      return {
        ok: false,
        message: `"${name}" no es válido. Solo se permiten archivos PDF.`,
      };
    }
    return { ok: false, message: PDF_ONLY_UPLOAD_MESSAGE };
  }

  return { ok: true };
}

function validateIneImageFile(
  file: File,
): { ok: true } | { ok: false; message: string } {
  const pdfValidation = validatePdfFile(file);
  if (pdfValidation.ok) return pdfValidation;

  const mime = (file.type || "").toLowerCase().trim();
  const name = fileName(file);

  if (
    ALLOWED_INE_IMAGE_MIME_TYPES.includes(
      mime as (typeof ALLOWED_INE_IMAGE_MIME_TYPES)[number],
    )
  ) {
    if (!hasImageExtension(name, mime)) {
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
      message: `"${name}" no es válido. ${INE_IMAGE_UPLOAD_MESSAGE}`,
    };
  }
  return { ok: false, message: INE_IMAGE_UPLOAD_MESSAGE };
}

export function validateExpedienteDocumentoUploadFile(
  file: File | null | undefined,
  tipoDocumento?: string | null,
): { ok: true } | { ok: false; message: string } {
  if (!file || file.size <= 0) {
    return { ok: false, message: "Selecciona un archivo válido." };
  }
  if (isIneImageDocumentTipo(tipoDocumento)) {
    return validateIneImageFile(file);
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
  if (isIneImageDocumentTipo(tipoDocumento)) {
    if (name) {
      return `"${name}" no es válido. ${fieldLabel}: ${INE_IMAGE_UPLOAD_MESSAGE}`;
    }
    return `${fieldLabel}: ${INE_IMAGE_UPLOAD_MESSAGE}`;
  }
  return formatPdfUploadRejectionForField(fieldLabel, file);
}
