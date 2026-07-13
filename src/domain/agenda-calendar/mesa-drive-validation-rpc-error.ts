import { MesaAgendaBookingsSupabaseError } from "./mesa.mapper";

export function mapMesaAgendaDriveValidationRpcError(error: {
  message?: string;
  code?: string;
}): MesaAgendaBookingsSupabaseError {
  const msg = `${error.message ?? ""}`.toLowerCase();
  if (msg.includes("rol no autorizado") || msg.includes("forbidden_role")) {
    return new MesaAgendaBookingsSupabaseError(
      "No tienes permiso para marcar Validado en Drive.",
    );
  }
  if (msg.includes("cita activa") || msg.includes("solo se puede validar")) {
    return new MesaAgendaBookingsSupabaseError(
      "Solo se puede validar una cita agendada (activa).",
    );
  }
  if (msg.includes("no encontrado") || msg.includes("no disponible")) {
    return new MesaAgendaBookingsSupabaseError(
      "No se encontró la cita para validar en Drive.",
    );
  }
  if (
    msg.includes("no autenticado") ||
    msg.includes("perfil no encontrado") ||
    msg.includes("not_authenticated") ||
    msg.includes("profile_inactive")
  ) {
    return new MesaAgendaBookingsSupabaseError("Sesión inválida. Inicia sesión de nuevo.");
  }
  if (msg.includes("organización") || msg.includes("no autorizado")) {
    return new MesaAgendaBookingsSupabaseError(
      "No tienes autorización para validar esta cita.",
    );
  }
  return new MesaAgendaBookingsSupabaseError(
    "No se pudo actualizar la validación en Drive. Intenta de nuevo.",
  );
}
