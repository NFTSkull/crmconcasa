import { AgendaBiometricosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `book_notificacion_etapa3` a mensajes claros para el asesor. */
export function mapBookNotificacionRpcError(error: {
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
      "No tienes permiso para agendar notificación.",
    );
  }

  if (msg.includes("solo el asesor dueño")) {
    return new AgendaBiometricosSupabaseError(
      "Solo el asesor dueño de este expediente puede agendar la notificación.",
    );
  }

  if (msg.includes("solo se puede agendar en etapa 3")) {
    return new AgendaBiometricosSupabaseError(
      "Solo puedes agendar notificación cuando el expediente está en etapa 3.",
    );
  }

  if (msg.includes("ya existe una notificación activa")) {
    return new AgendaBiometricosSupabaseError(
      "Este expediente ya tiene una notificación activa.",
    );
  }

  if (msg.includes("ya existe una cita biométrica activa")) {
    return new AgendaBiometricosSupabaseError(
      "Este expediente ya tiene una cita biométrica activa. Usa la pestaña Biométricos.",
    );
  }

  if (msg.includes("fecha debe ser futura")) {
    return new AgendaBiometricosSupabaseError(
      "La fecha de notificación debe ser futura.",
    );
  }

  if (msg.includes("notificacion_etapa3:")) {
    const cleaned = raw.replace(/^book_notificacion_etapa3:\s*/i, "");
    return new AgendaBiometricosSupabaseError(cleaned);
  }

  return new AgendaBiometricosSupabaseError(
    "No se pudo agendar la notificación. Intenta de nuevo más tarde.",
  );
}
