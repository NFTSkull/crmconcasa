import { mapBookFirmasRpcError } from "./book-firmas-rpc-error";
import { AgendaFirmasSupabaseError } from "./supabase.error";

/** Mapea errores de RPC `reagendar_firmas` a mensajes claros para el asesor. */
export function mapReagendarFirmasRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaFirmasSupabaseError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (msg.includes("no hay cita de firma activa para reagendar")) {
    return new AgendaFirmasSupabaseError(
      "No hay una cita de firma activa para reagendar.",
    );
  }

  if (msg.includes("solo se puede reagendar en etapa 9")) {
    return new AgendaFirmasSupabaseError(
      "Solo puedes reagendar firma cuando el expediente está en etapa 9 o 10.",
    );
  }

  if (msg.includes("conflicto al crear la nueva cita de firma")) {
    return new AgendaFirmasSupabaseError(
      "Este horario ya fue apartado. Selecciona otro horario.",
    );
  }

  const normalized = raw.replace(/^reagendar_firmas:\s*/gi, "book_firmas: ");
  return mapBookFirmasRpcError({
    ...error,
    message: normalized,
  });
}
