/**
 * Hotfix reagendar → Sheets: MOVER (no copiar).
 * Lógica pura / contratos; sin I/O. Identidad por booking UUID + expediente.
 */

export type RescheduleSheetSnapshot = Readonly<{
  bookingId: string;
  expedienteId: string;
  kind: "biometricos" | "firmas";
  oldBookingDate: string;
  oldBookingTime: string;
  newBookingDate: string;
  newBookingTime: string;
  locationId: string;
  oldSheetId: number | null;
  oldSheetTitle: string | null;
  oldSheetRow: number | null;
  oldInventoryId: string | null;
  newBookingId: string | null;
}>;

export type PriorCancelGateInput = Readonly<{
  /** Booking cancelado que debe limpiarse antes de escribir el nuevo. */
  priorCancelledBookingId: string | null | undefined;
  /** Outbox cancel/cleanup aún no done. */
  priorCancelOutboxPending: boolean;
  /** Link activo (deleted_at null) del booking cancelado. */
  priorActiveLinkExists: boolean;
  /** Fila Sheet aún muestra P = priorCancelledBookingId. */
  priorSheetRowStillOwned: boolean;
}>;

export type PriorCancelGateDecision =
  | { allowCreate: true; reason: "no_prior" | "prior_cleared" }
  | {
      allowCreate: false;
      reason:
        | "awaiting_prior_cancel_outbox"
        | "awaiting_prior_sheet_clear"
        | "awaiting_prior_link_clear";
    };

/** No escribir la nueva fila en Sheet si la anterior no está limpia. */
export function decidePriorCancelGate(
  input: PriorCancelGateInput,
): PriorCancelGateDecision {
  const prior = String(input.priorCancelledBookingId ?? "").trim();
  if (!prior) {
    return { allowCreate: true, reason: "no_prior" };
  }
  if (input.priorCancelOutboxPending) {
    return { allowCreate: false, reason: "awaiting_prior_cancel_outbox" };
  }
  if (input.priorActiveLinkExists) {
    return { allowCreate: false, reason: "awaiting_prior_link_clear" };
  }
  if (input.priorSheetRowStillOwned) {
    return { allowCreate: false, reason: "awaiting_prior_sheet_clear" };
  }
  return { allowCreate: true, reason: "prior_cleared" };
}

export type CancelCoordsResolution = Readonly<{
  sheetId: number | null;
  sheetTitle: string | null;
  sheetRow: number | null;
  inventoryId: string | null;
  source: "payload" | "active_link" | "soft_deleted_link" | "inventory" | "none";
}>;

/**
 * Resuelve coords de la fila a limpiar. Nunca por nombre/NSS.
 * Preferencia: payload → link activo → link soft-deleted → inventario.
 */
export function resolveCancelSheetCoords(input: {
  payloadSheetId?: number | null;
  payloadSheetTitle?: string | null;
  payloadSheetRow?: number | null;
  payloadInventoryId?: string | null;
  activeLink?: {
    sheetId?: number | null;
    sheetTitle?: string | null;
    rowNumber?: number | null;
  } | null;
  softDeletedLink?: {
    sheetId?: number | null;
    sheetTitle?: string | null;
    rowNumber?: number | null;
  } | null;
  inventory?: {
    sheetId?: number | null;
    sheetTitle?: string | null;
    sheetRow?: number | null;
    inventoryId?: string | null;
  } | null;
}): CancelCoordsResolution {
  const fromPayloadRow = Number(input.payloadSheetRow ?? 0);
  const fromPayloadTitle = String(input.payloadSheetTitle ?? "").trim();
  if (fromPayloadRow > 0 && fromPayloadTitle) {
    return {
      sheetId: Number(input.payloadSheetId ?? 0) || null,
      sheetTitle: fromPayloadTitle,
      sheetRow: fromPayloadRow,
      inventoryId: input.payloadInventoryId
        ? String(input.payloadInventoryId)
        : null,
      source: "payload",
    };
  }

  const activeRow = Number(input.activeLink?.rowNumber ?? 0);
  const activeTitle = String(input.activeLink?.sheetTitle ?? "").trim();
  if (activeRow > 0 && activeTitle) {
    return {
      sheetId: Number(input.activeLink?.sheetId ?? 0) || null,
      sheetTitle: activeTitle,
      sheetRow: activeRow,
      inventoryId: null,
      source: "active_link",
    };
  }

  const softRow = Number(input.softDeletedLink?.rowNumber ?? 0);
  const softTitle = String(input.softDeletedLink?.sheetTitle ?? "").trim();
  if (softRow > 0 && softTitle) {
    return {
      sheetId: Number(input.softDeletedLink?.sheetId ?? 0) || null,
      sheetTitle: softTitle,
      sheetRow: softRow,
      inventoryId: null,
      source: "soft_deleted_link",
    };
  }

  const invRow = Number(input.inventory?.sheetRow ?? 0);
  const invTitle = String(input.inventory?.sheetTitle ?? "").trim();
  if (invRow > 0 && invTitle) {
    return {
      sheetId: Number(input.inventory?.sheetId ?? 0) || null,
      sheetTitle: invTitle,
      sheetRow: invRow,
      inventoryId: input.inventory?.inventoryId
        ? String(input.inventory.inventoryId)
        : null,
      source: "inventory",
    };
  }

  return {
    sheetId: null,
    sheetTitle: null,
    sheetRow: null,
    inventoryId: null,
    source: "none",
  };
}

/**
 * Cancel sin coords: ¿marcar done no-op o failed para reintento/cleanup?
 * Solo no-op si no hubo evidencia CRM de fila Sheet.
 */
export function decideCancelMissingCoords(input: {
  hadSheetEvidence: boolean;
}): "done_noop" | "failed_missing_coords" {
  return input.hadSheetEvidence ? "failed_missing_coords" : "done_noop";
}

export function hadSheetEvidenceFromPayload(payload: {
  sheet_row?: unknown;
  sheet_title?: unknown;
  sheet_id?: unknown;
  inventory_id?: unknown;
  had_sheet_link?: unknown;
}): boolean {
  const row = Number(payload.sheet_row ?? 0);
  const title = String(payload.sheet_title ?? "").trim();
  if (row > 0 && title) return true;
  if (payload.inventory_id) return true;
  if (payload.had_sheet_link === true || payload.had_sheet_link === "true") {
    return true;
  }
  return false;
}

/** Orden de procesamiento outbox: cancel/cleanup antes que create (mismo claim). */
export function sortOutboxForRescheduleMove<
  T extends { event_type?: unknown; created_at?: unknown },
>(events: readonly T[]): T[] {
  const rank = (t: unknown): number => {
    const e = String(t ?? "");
    if (e === "booking_cancelled" || e === "booking_cancelled_cleanup") return 0;
    if (e === "booking_rescheduled") return 1;
    if (e === "booking_created") return 2;
    return 3;
  };
  return [...events].sort((a, b) => {
    const dr = rank(a.event_type) - rank(b.event_type);
    if (dr !== 0) return dr;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}

export type ClearedRowRestoreSnapshot = Readonly<{
  bookingId: string;
  expedienteId: string;
  sheetTitle: string;
  sheetRow: number;
  /** Valores B,C,D (índices 0..2 del write parcial). */
  visibleBCD: readonly [string, string, string];
  /** O:U (7 celdas). */
  techOU: readonly string[];
}>;

export function shouldRestorePriorAfterCreateFailure(input: {
  createFailed: boolean;
  priorClearedInBatch: boolean;
  restoreSnapshot: ClearedRowRestoreSnapshot | null | undefined;
}): boolean {
  return Boolean(
    input.createFailed &&
      input.priorClearedInBatch &&
      input.restoreSnapshot?.sheetTitle &&
      Number(input.restoreSnapshot.sheetRow) > 0,
  );
}

/** Idempotencia de reagenda Sheets: misma clave lógica no duplica escritura. */
export function rescheduleMoveIdempotencyKey(input: {
  oldBookingId: string;
  newBookingId: string;
  version?: string;
}): string {
  return `${input.oldBookingId}>${input.newBookingId}:move:${input.version ?? "v1"}`;
}
