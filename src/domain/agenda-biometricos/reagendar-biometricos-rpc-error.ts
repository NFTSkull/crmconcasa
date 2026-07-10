import { mapBookBiometricosRpcError } from "./book-biometricos-rpc-error";
import { AgendaBiometricosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `reagendar_biometricos` a mensajes claros para el asesor. */
export function mapReagendarBiometricosRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaBiometricosSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (msg.includes("no hay cita biométrica activa para reagendar")) {
    return new AgendaBiometricosSupabaseError(
      "No hay una cita biométrica activa para reagendar.",
    );
  }

  if (msg.includes("solo se puede reagendar en etapa 4")) {
    return new AgendaBiometricosSupabaseError(
      "Solo puedes reagendar biométricos cuando el expediente está en etapa 4.",
    );
  }

  if (msg.includes("conflicto al crear la nueva cita biométrica")) {
    return new AgendaBiometricosSupabaseError(
      "Este horario ya fue apartado. Selecciona otro horario.",
    );
  }

  const normalized = raw.replace(/^reagendar_biometricos:\s*/gi, "book_biometricos: ");
  return mapBookBiometricosRpcError({
    ...error,
    message: normalized,
  });
}
