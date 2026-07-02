import { ExpedienteArchivosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `register_expediente_documento_correccion`. */
export function mapRegisterExpedienteDocumentoCorreccionRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ExpedienteArchivosSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado o inactivo")
  ) {
    return new ExpedienteArchivosSupabaseError(
      "No tienes permiso para corregir documentos. Inicia sesión de nuevo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ExpedienteArchivosSupabaseError(
      "Solo el asesor dueño puede corregir documentos rechazados.",
    );
  }

  if (msg.includes("solo el asesor dueño")) {
    return new ExpedienteArchivosSupabaseError(
      "No tienes permiso para corregir documentos en este expediente.",
    );
  }

  if (msg.includes("tipo_documento no permitido")) {
    return new ExpedienteArchivosSupabaseError(
      "Este tipo de documento no puede corregirlo el asesor.",
    );
  }

  if (msg.includes("solo se puede corregir un documento rechazado")) {
    return new ExpedienteArchivosSupabaseError(
      "Solo puedes subir una corrección para documentos rechazados por Mesa.",
    );
  }

  if (msg.includes("aún no fue enviado a mesa")) {
    return new ExpedienteArchivosSupabaseError(
      "La corrección solo aplica después de enviar el expediente a Mesa.",
    );
  }

  if (msg.includes("objeto no encontrado en storage")) {
    return new ExpedienteArchivosSupabaseError(
      "No se encontró el archivo en almacenamiento. Intenta subir de nuevo.",
    );
  }

  if (msg.includes("mime_type no permitido")) {
    return new ExpedienteArchivosSupabaseError("Solo se permiten archivos PDF.");
  }

  if (msg.includes("excede tamaño máximo")) {
    return new ExpedienteArchivosSupabaseError("El archivo excede el tamaño máximo permitido (15 MB).");
  }

  if (msg.includes("could not find the function") || msg.includes("schema cache")) {
    return new ExpedienteArchivosSupabaseError(
      "La corrección de documentos aún no está disponible en el servidor. Contacta soporte.",
    );
  }

  return new ExpedienteArchivosSupabaseError(
    "No se pudo registrar la corrección del documento. Intenta de nuevo más tarde.",
  );
}
