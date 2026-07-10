import { AgendaBiometricosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `cancel_notificacion_etapa3`. */
export function mapCancelNotificacionRpcError(error: {
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
      "No tienes permiso para cancelar la notificación.",
    );
  }

  if (msg.includes("solo el asesor dueño")) {
    return new AgendaBiometricosSupabaseError(
      "Solo el asesor dueño puede cancelar la notificación.",
    );
  }

  if (msg.includes("solo se puede cancelar en etapa 3")) {
    return new AgendaBiometricosSupabaseError(
      "Solo puedes cancelar la notificación cuando el expediente está en etapa 3.",
    );
  }

  if (msg.includes("no hay notificación activa")) {
    return new AgendaBiometricosSupabaseError(
      "No hay una notificación activa para cancelar.",
    );
  }

  if (msg.includes("el motivo es obligatorio")) {
    return new AgendaBiometricosSupabaseError(
      "El motivo es obligatorio para cancelar desde Mesa.",
    );
  }

  if (raw) {
    const cleaned = raw.replace(/^cancel_notificacion_etapa3:\s*/i, "");
    return new AgendaBiometricosSupabaseError(cleaned);
  }

  return new AgendaBiometricosSupabaseError(
    "No se pudo cancelar la notificación. Intenta de nuevo más tarde.",
  );
}
