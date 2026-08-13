/**
 * Helpers UI / elegibilidad inscripción (sin PII técnica).
 */

import {
  INSCRIPCION_FIXED_TIME,
  INSCRIPCION_FIXED_TIME_DISPLAY,
} from "./constants";
import type {
  AgendaInscripcionRequirement,
  AgendaInscripcionRequirementStatus,
} from "./types";

export function formatInscripcionFixedTimeDisplay(
  bookingTime?: string | null,
): string {
  const t = String(bookingTime ?? "").trim().slice(0, 5);
  if (!t || t === INSCRIPCION_FIXED_TIME) return INSCRIPCION_FIXED_TIME_DISPLAY;
  // Contrato: backend siempre 11:00; UI no corrige DB — solo display canónico.
  return INSCRIPCION_FIXED_TIME_DISPLAY;
}

export function isInscripcionRequirementOpen(
  status: AgendaInscripcionRequirementStatus | string | null | undefined,
): boolean {
  return (
    status === "pending_booking" ||
    status === "booked" ||
    status === "rebook_required"
  );
}

export function isInscripcionAgendarCtaVisible(
  status: AgendaInscripcionRequirementStatus | string | null | undefined,
): boolean {
  return status === "pending_booking" || status === "rebook_required";
}

export function isInscripcionManageVisible(
  status: AgendaInscripcionRequirementStatus | string | null | undefined,
): boolean {
  return status === "booked";
}

/** Mesa: elegible para solicitar si etapa 3–7 y aún sin requirement abierto. */
export function canMesaSolicitarInscripcion(params: {
  etapaActual: number | null | undefined;
  submittedToMesa: boolean;
  cicloActivo: boolean;
  subestado: string | null | undefined;
  openRequirement: AgendaInscripcionRequirement | null;
}): boolean {
  if (!params.submittedToMesa || !params.cicloActivo) return false;
  if (params.subestado === "rechazado") return false;
  const etapa = Number(params.etapaActual);
  if (!Number.isFinite(etapa) || etapa < 3 || etapa > 7) return false;
  if (params.openRequirement && isInscripcionRequirementOpen(params.openRequirement.status)) {
    return false;
  }
  return true;
}

export function inscripcionRequirementStatusLabel(
  status: AgendaInscripcionRequirementStatus | string,
): string {
  if (status === "pending_booking" || status === "rebook_required") {
    return "Inscripción pendiente de agendar";
  }
  if (status === "booked") return "Cita de inscripción agendada";
  if (status === "completed") return "Inscripción concluida";
  if (status === "cancelled") return "Solicitud cancelada";
  return "Inscripción";
}

export function formatInscripcionCupoLabel(available: number, capacity: number): string {
  if (available <= 0) {
    return "No hay cupo de inscripción disponible para esta fecha/sede.";
  }
  if (capacity > 1) {
    return `${available} lugar${available === 1 ? "" : "es"} disponible${available === 1 ? "" : "s"}`;
  }
  return "Disponible";
}
