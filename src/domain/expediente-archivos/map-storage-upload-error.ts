import { EXPEDIENTE_DOCUMENTO_MAX_MB } from "./upload-constraints";
import { ExpedienteArchivosSupabaseError } from "./supabase.error";
import { isPdfOrImageDocumentTipo } from "@/lib/fileUploadValidation";

/** Mensajes claros para fallos de `storage.upload` (MIME vs tamaño vs genérico). */
export function mapSupabaseStorageUploadError(
  message: string | undefined,
  tipoDocumento?: string | null,
): ExpedienteArchivosSupabaseError {
  const msg = (message ?? "").toLowerCase();

  if (msg.includes("bucket")) {
    return new ExpedienteArchivosSupabaseError(
      "No se pudo acceder al almacenamiento de documentos. Contacta soporte.",
    );
  }

  if (
    msg.includes("row-level security") ||
    msg.includes("rls") ||
    msg.includes("policy") ||
    msg.includes("permission denied") ||
    msg.includes("not authorized") ||
    msg.includes("unauthorized")
  ) {
    return new ExpedienteArchivosSupabaseError(
      "No tienes permiso para subir este documento en el estado actual del expediente. Si ya fue enviado a Mesa, intenta reemplazar el archivo existente.",
    );
  }

  if (msg.includes("already exists") || msg.includes("duplicate")) {
    return new ExpedienteArchivosSupabaseError(
      "El archivo ya existe en almacenamiento. Intenta subir de nuevo.",
    );
  }

  if (
    msg.includes("maximum") ||
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
    if (isPdfOrImageDocumentTipo(tipoDocumento)) {
      return new ExpedienteArchivosSupabaseError(
        "Formato no permitido. Para este documento sube PDF o imagen (JPG, PNG, WEBP, HEIC).",
      );
    }
    return new ExpedienteArchivosSupabaseError(
      "Formato no permitido. Para este documento sube un archivo PDF válido.",
    );
  }

  return new ExpedienteArchivosSupabaseError(
    `No se pudo subir el archivo (${message?.trim() || "error de almacenamiento"}). Intenta de nuevo.`,
  );
}
