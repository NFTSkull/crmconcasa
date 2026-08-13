import { AgendaInscripcionError } from "./supabase.error";

const LAST_SLOT_MSG =
  "El último lugar disponible acaba de ocuparse. Selecciona otra fecha.";

/** Mapea errores RPC book/reagendar inscripción. */
export function mapBookInscripcionRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaInscripcionError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("no autenticado") ||
    msg.includes("solo asesor") ||
    msg.includes("no autorizado") ||
    msg.includes("no visible")
  ) {
    return new AgendaInscripcionError(
      "No tienes permiso para agendar esta cita de inscripción.",
      "AUTH",
    );
  }

  if (msg.includes("sin requirement abierto")) {
    return new AgendaInscripcionError(
      "No hay una solicitud de inscripción pendiente para este expediente.",
      "NO_REQUIREMENT",
    );
  }

  if (msg.includes("ya existe cita activa")) {
    return new AgendaInscripcionError(
      "Este expediente ya tiene una cita de inscripción agendada.",
      "ALREADY_BOOKED",
    );
  }

  if (
    msg.includes("sin_cupo_real_en_sheet") ||
    msg.includes("sin cupo") ||
    msg.includes("cupo")
  ) {
    return new AgendaInscripcionError(LAST_SLOT_MSG, "SIN_CUPO");
  }

  if (msg.includes("fecha inválida") || msg.includes("sede inválida")) {
    return new AgendaInscripcionError(
      "La fecha o sede seleccionada no es válida.",
      "INVALID_SLOT",
    );
  }

  if (msg.includes("no elegible") || msg.includes("expediente no disponible")) {
    return new AgendaInscripcionError(
      "Este expediente no puede agendar inscripción en su estado actual.",
      "NOT_ELIGIBLE",
    );
  }

  return new AgendaInscripcionError(
    raw || "No se pudo agendar la cita de inscripción.",
    "UNKNOWN",
  );
}

export function mapCancelInscripcionRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaInscripcionError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("no autenticado") ||
    msg.includes("no autorizado") ||
    msg.includes("no visible") ||
    msg.includes("rol no autorizado")
  ) {
    return new AgendaInscripcionError(
      "No tienes permiso para cancelar esta cita de inscripción.",
      "AUTH",
    );
  }

  if (msg.includes("no booked") || msg.includes("booking inválido")) {
    return new AgendaInscripcionError(
      "No hay una cita de inscripción activa para cancelar.",
      "NO_BOOKING",
    );
  }

  return new AgendaInscripcionError(
    raw || "No se pudo cancelar la cita de inscripción.",
    "UNKNOWN",
  );
}

export function mapMesaSolicitarInscripcionRpcError(error: {
  code?: string;
  message?: string;
  details?: string;
}): AgendaInscripcionError {
  const raw = `${error.message ?? ""} ${error.details ?? ""}`.trim();
  const msg = raw.toLowerCase();

  if (
    error.code === "42501" ||
    msg.includes("no autenticado") ||
    msg.includes("rol no autorizado") ||
    msg.includes("no visible")
  ) {
    return new AgendaInscripcionError(
      "No tienes permiso para solicitar la cita de inscripción.",
      "AUTH",
    );
  }

  if (msg.includes("motivo")) {
    return new AgendaInscripcionError(
      "El motivo es obligatorio.",
      "MOTIVO",
    );
  }

  if (
    msg.includes("sin evidencia biométrica") ||
    msg.includes("biometricos") ||
    msg.includes("biométric")
  ) {
    return new AgendaInscripcionError(
      "Se requiere evidencia de biométricos previos para solicitar inscripción.",
      "NO_BIO",
    );
  }

  if (msg.includes("no elegible") || msg.includes("expediente")) {
    return new AgendaInscripcionError(
      "Este expediente no es elegible para solicitar cita de inscripción.",
      "NOT_ELIGIBLE",
    );
  }

  return new AgendaInscripcionError(
    raw || "No se pudo solicitar la cita de inscripción.",
    "UNKNOWN",
  );
}

export { LAST_SLOT_MSG as INSCRIPCION_LAST_SLOT_MESSAGE };
