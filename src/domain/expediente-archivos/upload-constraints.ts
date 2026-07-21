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
    const message = fileValidation.message || PDF_ONLY_UPLOAD_MESSAGE;
    if (
      message.includes("vacío") ||
      message === "Selecciona un archivo válido."
    ) {
      return { ok: false, code: "archivo_vacio", message };
    }
    if (message.includes("15 MB") || message.includes("supera el límite")) {
      return { ok: false, code: "tamano_excedido", message };
    }
    return { ok: false, code: "mime_no_permitido", message };
  }

  if (file.size > EXPEDIENTE_DOCUMENTO_MAX_BYTES) {
    return {
      ok: false,
      code: "tamano_excedido",
      message:
        String(tipoDocumento ?? "").trim() === "cliente_pagare" ||
        String(tipoDocumento ?? "").trim() === "cliente_notificacion"
          ? "El archivo supera el límite de 15 MB."
          : `El archivo no puede superar ${EXPEDIENTE_DOCUMENTO_MAX_MB} MB.`,
    };
  }

  return { ok: true };
}
