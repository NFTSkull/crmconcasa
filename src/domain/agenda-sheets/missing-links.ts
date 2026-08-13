/**
 * P174 B1 — Clasificador READ ONLY: inventory con booking_id sin link activo.
 * No repara. No cambia hora / booking_time / Sheet.
 */

export type MissingLinkClass =
  | "HAS_ACTIVE_LINK"
  | "REPAIRABLE_BY_PQ"
  | "NOT_REPAIRABLE_MISSING_BOOKING"
  | "NOT_REPAIRABLE_EXPEDIENTE_MISMATCH"
  | "NOT_REPAIRABLE_MISSING_EXPEDIENTE"
  | "NO_BOOKING_ID";

export type MissingLinkVerdict = Readonly<{
  class: MissingLinkClass;
  repairable: boolean;
  reason: string;
}>;

/**
 * Determina si un inventory row con booking_id podría re-crear link
 * de forma segura usando solo UUIDs P/Q (sin tocar hora).
 */
export function classifyMissingInventoryLink(input: {
  inventoryBookingId: string | null | undefined;
  inventoryExpedienteId: string | null | undefined;
  hasActiveLink: boolean;
  bookingExists: boolean;
  bookingExpedienteId: string | null | undefined;
}): MissingLinkVerdict {
  const bookingId = String(input.inventoryBookingId ?? "").trim();
  if (!bookingId) {
    return {
      class: "NO_BOOKING_ID",
      repairable: false,
      reason: "inventory_without_booking_id",
    };
  }
  if (input.hasActiveLink) {
    return {
      class: "HAS_ACTIVE_LINK",
      repairable: false,
      reason: "link_already_active",
    };
  }
  if (!input.bookingExists) {
    return {
      class: "NOT_REPAIRABLE_MISSING_BOOKING",
      repairable: false,
      reason: "booking_row_missing",
    };
  }
  const invExp = String(input.inventoryExpedienteId ?? "").trim();
  const bookExp = String(input.bookingExpedienteId ?? "").trim();
  if (!bookExp) {
    return {
      class: "NOT_REPAIRABLE_MISSING_EXPEDIENTE",
      repairable: false,
      reason: "booking_without_expediente",
    };
  }
  if (invExp && invExp !== bookExp) {
    return {
      class: "NOT_REPAIRABLE_EXPEDIENTE_MISMATCH",
      repairable: false,
      reason: "inventory_q_vs_booking_expediente",
    };
  }
  return {
    class: "REPAIRABLE_BY_PQ",
    repairable: true,
    reason: "booking_and_expediente_uuid_ok",
  };
}
