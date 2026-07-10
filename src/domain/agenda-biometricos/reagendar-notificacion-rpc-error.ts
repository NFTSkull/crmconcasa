import { mapBookNotificacionRpcError } from "./book-notificacion-rpc-error";
import { AgendaBiometricosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `reagendar_notificacion_etapa3`. */
export function mapReagendarNotificacionRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaBiometricosSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (msg.includes("no hay notificación activa para reagendar")) {
    return new AgendaBiometricosSupabaseError(
      "No hay una notificación activa para reagendar.",
    );
  }

  if (msg.includes("solo se puede reagendar en etapa 3")) {
    return new AgendaBiometricosSupabaseError(
      "Solo puedes reagendar la notificación cuando el expediente está en etapa 3.",
    );
  }

  const normalized = raw.replace(/^reagendar_notificacion_etapa3:\s*/gi, "book_notificacion_etapa3: ");
  return mapBookNotificacionRpcError({
    ...error,
    message: normalized,
  });
}
