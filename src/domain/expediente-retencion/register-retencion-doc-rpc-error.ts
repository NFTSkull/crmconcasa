import { ExpedienteRetencionSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `register_expediente_documento_retencion` a mensajes claros en español. */
export function mapRegisterRetencionDocRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): ExpedienteRetencionSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado o inactivo")
  ) {
    return new ExpedienteRetencionSupabaseError(
      "No tienes permiso para subir documentos. Inicia sesión como asesor activo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new ExpedienteRetencionSupabaseError(
      "Solo un asesor puede subir documentos de retención.",
    );
  }

  if (msg.includes("solo el asesor dueño") || msg.includes("fuera de la organización")) {
    return new ExpedienteRetencionSupabaseError(
      "No tienes permiso para subir documentos en este expediente.",
    );
  }

  if (error.code === "P0002" || msg.includes("expediente no encontrado")) {
    return new ExpedienteRetencionSupabaseError(
      "Expediente no encontrado o no tienes permiso para verlo.",
    );
  }

  if (msg.includes("expediente no disponible")) {
    return new ExpedienteRetencionSupabaseError("Este expediente ya no está disponible.");
  }

  if (msg.includes("aún no fue enviado a mesa") || msg.includes("no enviado a mesa")) {
    return new ExpedienteRetencionSupabaseError(
      "Los documentos de retención solo se suben después de que el expediente fue enviado a Mesa.",
    );
  }

  if (msg.includes("debe estar en etapa 8")) {
    return new ExpedienteRetencionSupabaseError(
      "Solo puedes subir documentos de retención cuando el expediente está en etapa 8.",
    );
  }

  if (msg.includes("subestado debe ser en_proceso")) {
    return new ExpedienteRetencionSupabaseError(
      "No puedes subir documentos en el subestado actual del expediente.",
    );
  }

  if (msg.includes("tipo_documento no permitido")) {
    return new ExpedienteRetencionSupabaseError(
      "Este tipo de documento no corresponde al flujo de retención.",
    );
  }

  if (msg.includes("documento validado")) {
    return new ExpedienteRetencionSupabaseError(
      "Este documento ya fue aceptado por Mesa. Espera un rechazo antes de reemplazarlo.",
    );
  }

  if (msg.includes("objeto no encontrado en storage")) {
    return new ExpedienteRetencionSupabaseError(
      "No se encontró el archivo en almacenamiento. Intenta subir de nuevo.",
    );
  }

  if (msg.includes("mime_type no permitido")) {
    return new ExpedienteRetencionSupabaseError("Solo se permiten archivos PDF.");
  }

  if (msg.includes("excede tamaño máximo")) {
    return new ExpedienteRetencionSupabaseError(
      "El archivo excede el tamaño máximo permitido (15 MB).",
    );
  }

  if (msg.includes("size_bytes debe ser mayor a 0")) {
    return new ExpedienteRetencionSupabaseError("El archivo está vacío o no es válido.");
  }

  if (msg.includes("storage_path no coincide")) {
    return new ExpedienteRetencionSupabaseError(
      "Error interno al registrar el documento. Intenta subir de nuevo.",
    );
  }

  if (msg.includes("ciclo activo")) {
    return new ExpedienteRetencionSupabaseError(
      "No puedes subir documentos en el estado actual del expediente.",
    );
  }

  return new ExpedienteRetencionSupabaseError(
    "No se pudo registrar el documento de retención. Intenta de nuevo más tarde.",
  );
}
