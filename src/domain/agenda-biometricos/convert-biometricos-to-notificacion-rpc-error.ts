import { AgendaBiometricosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `convert_biometricos_to_notificacion` (P070). */
export function mapConvertBiometricosToNotificacionRpcError(error: {
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
      "Solo el asesor dueño puede convertir biométricos a notificación.",
    );
  }

  if (msg.includes("asesor dueño")) {
    return new AgendaBiometricosSupabaseError(
      "Solo el asesor dueño de este expediente puede hacer la conversión.",
    );
  }

  if (msg.includes("solo etapas 3 o 4")) {
    return new AgendaBiometricosSupabaseError(
      "La conversión solo está disponible en etapa 3 o 4 con biométricos activos.",
    );
  }

  if (msg.includes("no hay cita biométrica activa")) {
    return new AgendaBiometricosSupabaseError(
      "No hay una cita biométrica activa para convertir.",
    );
  }

  if (msg.includes("ya existe una notificación activa")) {
    return new AgendaBiometricosSupabaseError(
      "Este expediente ya tiene una notificación activa.",
    );
  }

  if (msg.includes("fecha debe ser futura")) {
    return new AgendaBiometricosSupabaseError(
      "La fecha de notificación debe ser futura.",
    );
  }

  if (msg.includes("ciclo activo") || msg.includes("enviado a mesa") || msg.includes("en_proceso")) {
    return new AgendaBiometricosSupabaseError(
      "El expediente no está en condiciones de convertir la cita ahora.",
    );
  }

  if (msg.includes("convert_biometricos_to_notificacion:")) {
    const cleaned = raw.replace(/^convert_biometricos_to_notificacion:\s*/i, "");
    return new AgendaBiometricosSupabaseError(cleaned);
  }

  return new AgendaBiometricosSupabaseError(
    "No se pudo convertir a notificación. Intenta de nuevo más tarde.",
  );
}
