import { ExpedienteArchivosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `register_expediente_documento` a mensajes claros en español. */
export function mapRegisterExpedienteDocumentoRpcError(error: {
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
      "No tienes permiso para subir documentos. Inicia sesión como asesor activo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ExpedienteArchivosSupabaseError(
      "Solo un asesor puede subir documentos de integración.",
    );
  }

  if (msg.includes("solo el asesor dueño") || msg.includes("fuera de la organización")) {
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

  if (msg.includes("ya fue enviado a mesa")) {
    return new ExpedienteArchivosSupabaseError(
      "No puedes subir documentos: el expediente ya fue enviado a Mesa.",
    );
  }

  if (msg.includes("tipo_documento no permitido")) {
    return new ExpedienteArchivosSupabaseError(
      "Este tipo de documento no corresponde al checklist del asesor.",
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

  if (msg.includes("size_bytes debe ser mayor a 0")) {
    return new ExpedienteArchivosSupabaseError("El archivo está vacío o no es válido.");
  }

  if (msg.includes("storage_path no coincide")) {
    return new ExpedienteArchivosSupabaseError(
      "Error interno al registrar el documento. Intenta subir de nuevo.",
    );
  }

  if (msg.includes("ciclo activo")) {
    return new ExpedienteArchivosSupabaseError(
      "No puedes subir documentos en el estado actual del expediente.",
    );
  }

  return new ExpedienteArchivosSupabaseError(
    "No se pudo registrar el documento. Intenta de nuevo más tarde.",
  );
}
