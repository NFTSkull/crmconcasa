import { mapBookBiometricosRpcError } from "./book-biometricos-rpc-error";
import { AgendaBiometricosSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `mesa_reagendar_biometricos`. */
export function mapMesaReagendarBiometricosRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaBiometricosSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (msg.includes("no hay cita biométrica activa")) {
    return new AgendaBiometricosSupabaseError(
      "No hay una cita biométrica activa para reagendar.",
    );
  }

  if (msg.includes("rol no autorizado")) {
    return new AgendaBiometricosSupabaseError(
      "No tienes permiso para reagendar citas biométricas.",
    );
  }

  if (msg.includes("conflicto al crear la nueva cita biométrica")) {
    return new AgendaBiometricosSupabaseError(
      "Este horario ya fue apartado. Selecciona otro horario.",
    );
  }

  const normalized = raw.replace(/^mesa_reagendar_biometricos:\s*/gi, "book_biometricos: ");
  return mapBookBiometricosRpcError({
    ...error,
    message: normalized,
  });
}
