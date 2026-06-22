/** Límites P3H.2 — espejo de `expediente_documento_max_size_bytes()` y `expediente_documento_mime_permitido()`. */
export const EXPEDIENTE_DOCUMENTO_MAX_BYTES = 15 * 1024 * 1024;

export const EXPEDIENTE_DOCUMENTO_MAX_MB = 15;

export const EXPEDIENTE_DOCUMENTOS_BUCKET = "expediente-documentos";

export const EXPEDIENTE_DOCUMENTO_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
] as const;

const ALLOWED_MIME_SET = new Set<string>(EXPEDIENTE_DOCUMENTO_ALLOWED_MIME_TYPES);

export const EXPEDIENTE_DOCUMENTO_ACCEPT_ATTR =
  ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

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
  if (!file || file.size <= 0) {
    return {
      ok: false,
      code: "archivo_vacio",
      message: "Selecciona un archivo válido.",
    };
  }

  const mime = (file.type || "").toLowerCase().trim();
  if (!ALLOWED_MIME_SET.has(mime)) {
    return {
      ok: false,
      code: "mime_no_permitido",
      message: "Solo se permiten archivos PDF, JPG o PNG.",
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
