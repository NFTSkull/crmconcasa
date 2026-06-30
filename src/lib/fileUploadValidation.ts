export const ALLOWED_UPLOAD_MIME_TYPES = ["application/pdf"] as const;

export const ALLOWED_UPLOAD_EXTENSIONS = [".pdf"] as const;

export const PDF_ONLY_UPLOAD_MESSAGE =
  "Solo se permiten archivos PDF. Convierte el documento a PDF antes de subirlo.";

function fileName(file: File): string {
  return String(file.name ?? "").trim();
}

function hasPdfExtension(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
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
