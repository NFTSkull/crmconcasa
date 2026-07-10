import { AgendaBiometricosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `book_biometricos` a mensajes claros para el asesor. */
export function mapBookBiometricosRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaBiometricosSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("usuario no autenticado") ||
    msg.includes("perfil no encontrado o inactivo")
  ) {
    return new AgendaBiometricosSupabaseError(
      "Tu sesión expiró. Inicia sesión de nuevo.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new AgendaBiometricosSupabaseError(
      "No tienes permiso para agendar biométricos.",
    );
  }

  if (msg.includes("solo el asesor dueño")) {
    return new AgendaBiometricosSupabaseError(
      "Solo el asesor dueño de este expediente puede agendar la cita.",
    );
  }

  if (msg.includes("solo se puede agendar en etapa 4")) {
    return new AgendaBiometricosSupabaseError(
      "Solo puedes agendar biométricos cuando el expediente está en etapa 4.",
    );
  }

  if (
    msg.includes("ya existe una cita biométrica activa") ||
    msg.includes("unique_violation")
  ) {
    return new AgendaBiometricosSupabaseError(
      "Este expediente ya tiene una cita biométrica activa.",
    );
  }

  if (msg.includes("cupo agotado") || msg.includes("capacity")) {
    return new AgendaBiometricosSupabaseError(
      "Este horario ya fue apartado. Selecciona otro horario.",
    );
  }

  if (msg.includes("anticipación mínima") || msg.includes("fecha no cumple anticipación")) {
    return new AgendaBiometricosSupabaseError(
      "La fecha u hora no cumple la anticipación mínima configurada por Mesa.",
    );
  }

  if (
    msg.includes("día no permitido") ||
    msg.includes("horario no permitido") ||
    msg.includes("sede no permitida") ||
    msg.includes("sede deshabilitada") ||
    msg.includes("agenda biométricos deshabilitada") ||
    msg.includes("configuración biométricos no encontrada")
  ) {
    return new AgendaBiometricosSupabaseError(
      "El horario seleccionado no está disponible en la agenda configurada por Mesa.",
    );
  }

  if (
    msg.includes("la cita debe ser en fecha/hora futura") ||
    msg.includes("scheduled_at es obligatorio") ||
    msg.includes("location_id es obligatorio")
  ) {
    return new AgendaBiometricosSupabaseError(
      "Selecciona una fecha y hora válidas en el futuro.",
    );
  }

  if (msg.includes("expediente no ha sido enviado a mesa")) {
    return new AgendaBiometricosSupabaseError(
      "El expediente debe estar enviado a Mesa antes de agendar biométricos.",
    );
  }

  if (msg.includes("expediente no encontrado") || msg.includes("expediente no disponible")) {
    return new AgendaBiometricosSupabaseError("Expediente no encontrado o no disponible.");
  }

  if (msg.includes("expediente fuera de la organización")) {
    return new AgendaBiometricosSupabaseError(
      "No puedes agendar biométricos en un expediente de otra organización.",
    );
  }

  if (raw) {
    const cleaned = raw.replace(/^book_biometricos:\s*/i, "").replace(/^agenda_config:\s*/i, "");
    return new AgendaBiometricosSupabaseError(cleaned);
  }

  return new AgendaBiometricosSupabaseError(
    "No se pudo agendar la cita biométrica. Intenta de nuevo más tarde.",
  );
}
