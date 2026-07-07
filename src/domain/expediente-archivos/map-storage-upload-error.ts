import { EXPEDIENTE_DOCUMENTO_MAX_MB } from "./upload-constraints";
import { ExpedienteArchivosSupabaseError } from "./supabase.error";

/** Mensajes claros para fallos de `storage.upload` (MIME vs tamaño vs genérico). */
export function mapSupabaseStorageUploadError(
  message: string | undefined,
): ExpedienteArchivosSupabaseError {
  const msg = (message ?? "").toLowerCase();

  if (msg.includes("bucket")) {
    return new ExpedienteArchivosSupabaseError(
      "No se pudo acceder al almacenamiento de documentos. Contacta soporte.",
    );
  }

  if (
    msg.includes("maximum") ||
    msg.includes("max") ||
    msg.includes("too large") ||
    msg.includes("exceed") ||
    msg.includes("payload") ||
    msg.includes("size limit") ||
    msg.includes("file size")
  ) {
    return new ExpedienteArchivosSupabaseError(
      `El archivo excede el tamaño máximo permitido (${EXPEDIENTE_DOCUMENTO_MAX_MB} MB).`,
    );
  }

  if (
    msg.includes("mime") ||
    msg.includes("content type") ||
    msg.includes("not allowed") ||
    msg.includes("invalid file type")
  ) {
    return new ExpedienteArchivosSupabaseError(
      "Formato no permitido. Para este documento sube un archivo PDF válido.",
    );
  }

  return new ExpedienteArchivosSupabaseError(
    "No se pudo subir el archivo. Verifica que sea PDF y que no supere 15 MB.",
  );
}
