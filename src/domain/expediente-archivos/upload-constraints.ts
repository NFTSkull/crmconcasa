/** Límites P3H.2 — espejo de `expediente_documento_max_size_bytes()` y `expediente_documento_mime_permitido()`. */
import {
  EXPEDIENTE_DOCUMENTO_PDF_ACCEPT_ATTR,
  PDF_ONLY_UPLOAD_MESSAGE,
  validateExpedienteDocumentoUploadFile,
} from "@/lib/fileUploadValidation";

export const EXPEDIENTE_DOCUMENTO_MAX_BYTES = 15 * 1024 * 1024;

export const EXPEDIENTE_DOCUMENTO_MAX_MB = 15;

export const EXPEDIENTE_DOCUMENTOS_BUCKET = "expediente-documentos";

export const EXPEDIENTE_DOCUMENTO_ALLOWED_MIME_TYPES = ["application/pdf"] as const;

/** @deprecated Usar `getExpedienteDocumentoAcceptAttr(tipo)` desde `fileUploadValidation`. */
export const EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR = EXPEDIENTE_DOCUMENTO_PDF_ACCEPT_ATTR;

export type ExpedienteDocumentoValidationError =
  | "tipo_invalido"
  | "tamano_excedido"
  | "mime_no_permitido"
  | "archivo_vacio";

export function validateExpedienteDocumentoFile(
  file: File,
  tipoDocumento?: string | null,
): {
  ok: true;
} | {
  ok: false;
  code: ExpedienteDocumentoValidationError;
  message: string;
} {
  const fileValidation = validateExpedienteDocumentoUploadFile(file, tipoDocumento);
  if (!fileValidation.ok) {
    return {
      ok: false,
      code: fileValidation.message === "Selecciona un archivo válido."
        ? "archivo_vacio"
        : "mime_no_permitido",
      message:
        fileValidation.message === "Selecciona un archivo válido."
          ? fileValidation.message
          : fileValidation.message || PDF_ONLY_UPLOAD_MESSAGE,
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
