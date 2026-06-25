import { ExpedienteArchivosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `register_mesa_documento` a mensajes claros en español. */
export function mapRegisterMesaDocumentoRpcError(error: {
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
      "No tienes permiso para subir documentos. Inicia sesión de nuevo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ExpedienteArchivosSupabaseError(
      "Solo Mesa de control puede subir estos documentos.",
    );
  }

  if (msg.includes("no autorizado para operar") || msg.includes("fuera de la organización")) {
    return new ExpedienteArchivosSupabaseError(
      "No tienes permiso para subir documentos en este expediente.",
    );
  }

  if (error.code === "P0002" || msg.includes("expediente no encontrado")) {
    return new ExpedienteArchivosSupabaseError(
      "Expediente no encontrado o no tienes permiso para verlo.",
    );
  }

  if (msg.includes("expediente no disponible")) {
    return new ExpedienteArchivosSupabaseError("Este expediente ya no está disponible.");
  }

  if (msg.includes("aún no fue enviado a mesa")) {
    return new ExpedienteArchivosSupabaseError(
      "Solo puedes subir estos documentos después de que el expediente fue enviado a Mesa.",
    );
  }

  if (msg.includes("tipo_documento no permitido")) {
    return new ExpedienteArchivosSupabaseError(
      "Este tipo de documento no puede subirlo Mesa de control.",
    );
  }

  if (msg.includes("objeto no encontrado en storage")) {
    return new ExpedienteArchivosSupabaseError(
      "No se encontró el archivo en almacenamiento. Intenta subir de nuevo.",
    );
  }

  if (msg.includes("mime_type no permitido")) {
    return new ExpedienteArchivosSupabaseError("Solo se permiten archivos PDF, JPG o PNG.");
  }

  if (msg.includes("excede tamaño máximo")) {
    return new ExpedienteArchivosSupabaseError("El archivo excede el tamaño máximo permitido (15 MB).");
  }

  if (msg.includes("could not find the function") || msg.includes("schema cache")) {
    return new ExpedienteArchivosSupabaseError(
      "La subida de documentos por Mesa aún no está disponible en el servidor. Contacta soporte.",
    );
  }

  return new ExpedienteArchivosSupabaseError(
    "No se pudo registrar el documento. Intenta de nuevo más tarde.",
  );
}
