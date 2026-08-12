/**
 * P172 B1.1 — helpers puros para B2 (sin render UI).
 * Badge / hide cancel-reagendar-Drive-bulk selection.
 */

import { CONTINGENCY_BADGE_LABEL } from "./types";

export { CONTINGENCY_BADGE_LABEL };

export type ContingencyOriginalBookingFlags = Readonly<{
  /** Booking es original_booking_id de una contingencia active|closed. */
  underContingency: boolean;
  contingencyStatus?: "active" | "closed" | null;
  contingencyItemStatus?: "pending_rebook" | "rebooked" | "closed" | null;
  contingencyId?: string | null;
  contingencyItemId?: string | null;
}>;

/**
 * True si el booking normal es el original afectado por contingencia
 * (active o closed). closed ≠ voided.
 */
export function isContingencyOriginalBooking(
  flags: ContingencyOriginalBookingFlags | null | undefined,
): boolean {
  return Boolean(flags?.underContingency);
}

/** Acciones normales que B2 debe ocultar/deshabilitar. */
export function contingencyOriginalBlockedActions(
  flags: ContingencyOriginalBookingFlags | null | undefined,
): Readonly<{
  cancel: boolean;
  reagendar: boolean;
  driveValidation: boolean;
  bulkSelect: boolean;
  gestionarNormal: boolean;
}> {
  const blocked = isContingencyOriginalBooking(flags);
  return {
    cancel: blocked,
    reagendar: blocked,
    driveValidation: blocked,
    bulkSelect: blocked,
    gestionarNormal: blocked,
  };
}

/**
 * Avance bulk/manual: `avanzar_etapa_operativa` NO recibe booking_id.
 * No bloquear expediente globalmente en SQL.
 * B2 debe filtrar selección bulk con `contingencyOriginalBlockedActions.bulkSelect`.
 */
export const CONTINGENCY_ADVANCE_LIMITATION =
  "avanzar_etapa_operativa no recibe booking_id; protección de avance-from-agenda queda en UI B2 + P170 SKIPPED_CONTINGENCY server-side." as const;
