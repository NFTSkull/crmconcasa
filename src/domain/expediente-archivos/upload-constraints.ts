/** Límites P3H.2 — espejo de `expediente_documento_max_size_bytes()` y `expediente_documento_mime_permitido()`. */
import { PDF_ONLY_UPLOAD_MESSAGE, validatePdfFile } from "@/lib/fileUploadValidation";

export const EXPEDIENTE_DOCUMENTO_MAX_BYTES = 15 * 1024 * 1024;

export const EXPEDIENTE_DOCUMENTO_MAX_MB = 15;

export const EXPEDIENTE_DOCUMENTOS_BUCKET = "expediente-documentos";

export const EXPEDIENTE_DOCUMENTO_ALLOWED_MIME_TYPES = ["application/pdf"] as const;

export const EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR = "application/pdf,.pdf";

export type ExpedienteDocumentoValidationError =
  | "tipo_invalido"
  | "tamano_excedido"
  | "mime_no_permitido"
  | "archivo_vacio";

export function validateExpedienteDocumentoFile(file: File): {
  ok: true;
} | {
  ok: false;
  code: ExpedienteDocumentoValidationError;
  message: string;
} {
  const pdfValidation = validatePdfFile(file);
  if (!pdfValidation.ok) {
    return {
      ok: false,
      code: pdfValidation.message === "Selecciona un archivo válido."
        ? "archivo_vacio"
        : "mime_no_permitido",
      message:
        pdfValidation.message === "Selecciona un archivo válido."
          ? pdfValidation.message
          : pdfValidation.message || PDF_ONLY_UPLOAD_MESSAGE,
    };
  }

  if (file.size > EXPEDIENTE_DOCUMENTO_MAX_BYTES) {
    return {
      ok: false,
      code: "tamano_excedido",
      message: `El archivo no puede superar ${EXPEDIENTE_DOCUMENTO_MAX_MB} MB.`,
    };
  }

  return { ok: true };
}
