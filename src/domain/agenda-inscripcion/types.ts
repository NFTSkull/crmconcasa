/**
 * Tipos FE/domain P175 — requisito + booking activo de inscripción.
 * Crear requisito no muta etapa; book/cancel viven en RPCs posteriores.
 */

import { INSCRIPCION_BOOKING_KIND } from "./constants";

export type AgendaInscripcionRequirementStatus =
  | "pending_booking"
  | "booked"
  | "completed"
  | "cancelled"
  | "rebook_required";

export type AgendaInscripcionRequirementSourceType = "sheet" | "mesa";

export type AgendaInscripcionRequirement = Readonly<{
  id: string;
  organizationId: string;
  expedienteId: string;
  sourceBookingId: string | null;
  sourceKind: string | null;
  sourceType: AgendaInscripcionRequirementSourceType;
  status: AgendaInscripcionRequirementStatus;
  requestedBy: string | null;
  requestedAt: string;
  bookedBookingId: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  reason: string | null;
  sourceSheetId: number | null;
  sourceSheetRow: number | null;
  createdAt: string;
  updatedAt: string;
}>;

/** Cita activa kind=inscripcion (hora fija 11:00). */
export type AgendaInscripcionActiveBooking = Readonly<{
  bookingId: string;
  expedienteId: string;
  bookingDate: string;
  bookingTime: string;
  locationId: string;
  status: "booked";
  kind: typeof INSCRIPCION_BOOKING_KIND;
}>;

/** Kind de tarea persistente (campana), patrón extraordinary_rebook_required. */
export const INSCRIPCION_REBOOK_TASK_KIND =
  "inscripcion_rebook_required" as const;
export type InscripcionRebookTaskKind = typeof INSCRIPCION_REBOOK_TASK_KIND;
