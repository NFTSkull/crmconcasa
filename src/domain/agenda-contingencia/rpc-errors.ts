/** Errores RPC P172 (mensajes FE-safe, sin PII). */

export class AgendaContingenciaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AgendaContingenciaError";
    this.code = code;
  }
}

function rawOf(error: {
  code?: string;
  message?: string;
  details?: string;
}): string {
  return `${error.message ?? ""} ${error.details ?? ""}`.trim();
}

export function mapDeclararContingenciaRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaContingenciaError {
  const raw = rawOf(error);
  const msg = raw.toLowerCase();

  if (error.code === "42501" || msg.includes("unauthorized")) {
    return new AgendaContingenciaError(
      "UNAUTHORIZED",
      "No tienes permiso para declarar contingencia.",
    );
  }
  if (msg.includes("booking_under_contingency")) {
    return new AgendaContingenciaError(
      "BOOKING_UNDER_CONTINGENCY",
      "Esta cita está bajo contingencia: no se puede cancelar, reagendar ni validar en Drive.",
    );
  }
  if (msg.includes("no_affected")) {
    return new AgendaContingenciaError(
      "NO_AFFECTED",
      "No hay citas booked afectadas para esa fecha/tipo/sede.",
    );
  }
  if (msg.includes("reason_invalid") || msg.includes("kind_invalid")) {
    return new AgendaContingenciaError(
      "INPUT_INVALID",
      "Revisa fecha, tipo y motivo de la contingencia.",
    );
  }
  return new AgendaContingenciaError(
    "UNKNOWN",
    "No se pudo declarar la contingencia. Intenta de nuevo.",
  );
}

export function mapAgendarExtraordinariaRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaContingenciaError {
  const raw = rawOf(error);
  const msg = raw.toLowerCase();

  if (error.code === "42501" || msg.includes("forbidden") || msg.includes("unauthorized")) {
    return new AgendaContingenciaError(
      "FORBIDDEN",
      "Solo el asesor dueño puede agendar la cita extraordinaria.",
    );
  }
  if (msg.includes("not_pending") || msg.includes("duplicate")) {
    return new AgendaContingenciaError(
      "ALREADY_REBOOKED",
      "Esta contingencia ya tiene una cita extraordinaria.",
    );
  }
  if (msg.includes("inactive")) {
    return new AgendaContingenciaError(
      "INACTIVE",
      "La contingencia ya no está activa.",
    );
  }
  return new AgendaContingenciaError(
    "UNKNOWN",
    "No se pudo agendar la cita extraordinaria. Intenta de nuevo.",
  );
}
