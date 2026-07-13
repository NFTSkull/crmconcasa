import { AgendaBiometricosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `mesa_reagendar_notificacion`. */
export function mapMesaReagendarNotificacionRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaBiometricosSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (msg.includes("no hay notificación activa")) {
    return new AgendaBiometricosSupabaseError(
      "No hay una notificación activa para reagendar.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new AgendaBiometricosSupabaseError(
      "No tienes permiso para reagendar notificaciones.",
    );
  }

  if (msg.includes("solo se puede reagendar en etapa 3")) {
    return new AgendaBiometricosSupabaseError(
      "Solo puedes reagendar notificación en etapa 3.",
    );
  }

  if (msg.includes("fecha debe ser futura")) {
    return new AgendaBiometricosSupabaseError("La fecha debe ser futura.");
  }

  const cleaned = raw.replace(/^mesa_reagendar_notificacion:\s*/i, "");
  return new AgendaBiometricosSupabaseError(
    cleaned || "No se pudo reagendar la notificación.",
  );
}
