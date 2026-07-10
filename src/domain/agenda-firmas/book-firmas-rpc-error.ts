import { AgendaFirmasSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `book_firmas` a mensajes claros para el asesor. */
export function mapBookFirmasRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaFirmasSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado o inactivo")
  ) {
    return new AgendaFirmasSupabaseError(
      "Tu sesión expiró. Inicia sesión de nuevo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new AgendaFirmasSupabaseError(
      "No tienes permiso para agendar firmas.",
    );
  }

  if (msg.includes("solo el asesor dueño")) {
    return new AgendaFirmasSupabaseError(
      "Solo el asesor dueño de este expediente puede agendar la firma.",
    );
  }

  if (msg.includes("solo se puede agendar en etapa 9")) {
    return new AgendaFirmasSupabaseError(
      "Solo puedes agendar firma cuando el expediente está en etapa 9.",
    );
  }

  if (
    msg.includes("ya existe una cita de firma activa") ||
    msg.includes("unique_violation")
  ) {
    return new AgendaFirmasSupabaseError(
      "Este expediente ya tiene una cita de firma activa.",
    );
  }

  if (msg.includes("cupo agotado") || msg.includes("cupo firmas agotado") || msg.includes("capacity")) {
    return new AgendaFirmasSupabaseError(
      "Este horario ya fue apartado. Selecciona otro horario.",
    );
  }

  if (msg.includes("anticipación mínima") || msg.includes("fecha firmas no cumple")) {
    return new AgendaFirmasSupabaseError(
      "La fecha u hora no cumple la anticipación mínima configurada por Mesa.",
    );
  }

  if (
    msg.includes("día firmas no permitido") ||
    msg.includes("horario firmas no permitido") ||
    msg.includes("sede firmas no permitida") ||
    msg.includes("sede firmas deshabilitada") ||
    msg.includes("agenda firmas deshabilitada") ||
    msg.includes("configuración firmas no encontrada")
  ) {
    return new AgendaFirmasSupabaseError(
      "El horario seleccionado no está disponible en la agenda configurada por Mesa.",
    );
  }

  if (
    msg.includes("la cita debe ser en fecha/hora futura") ||
    msg.includes("scheduled_at es obligatorio") ||
    msg.includes("location_id es obligatorio")
  ) {
    return new AgendaFirmasSupabaseError(
      "Selecciona una fecha y hora válidas en el futuro.",
    );
  }

  if (msg.includes("expediente no ha sido enviado a mesa")) {
    return new AgendaFirmasSupabaseError(
      "El expediente debe estar enviado a Mesa antes de agendar firma.",
    );
  }

  if (msg.includes("expediente no encontrado") || msg.includes("expediente no disponible")) {
    return new AgendaFirmasSupabaseError("Expediente no encontrado o no disponible.");
  }

  if (msg.includes("expediente fuera de la organización")) {
    return new AgendaFirmasSupabaseError(
      "No puedes agendar firma en un expediente de otra organización.",
    );
  }

  if (raw) {
    const cleaned = raw.replace(/^book_firmas:\s*/i, "").replace(/^agenda_config:\s*/i, "");
    return new AgendaFirmasSupabaseError(cleaned);
  }

  return new AgendaFirmasSupabaseError(
    "No se pudo agendar la cita de firma. Intenta de nuevo más tarde.",
  );
}
