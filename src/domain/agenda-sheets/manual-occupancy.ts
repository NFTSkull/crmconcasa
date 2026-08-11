/**
 * Ocupación física Sheet → inventario CRM (hotfix inbound).
 * Google Sheet = ocupación real. Contar filas físicas, no personas/bookings.
 */

export type SheetOccupancyClass =
  | "FREE"
  | "OCCUPIED_CRM"
  | "OCCUPIED_MANUAL"
  | "RESCHEDULED_HISTORY"
  | "ANOMALY"
  | "MANUAL_ENTRY_WITHOUT_SLOT";

export type InventoryReconcileClass =
  | "MATCHED_CRM"
  | "MANUAL_OCCUPIED"
  | "FREE"
  | "RESCHEDULED_HISTORY"
  | "CRM_BOOKING_MISSING_FROM_SHEET"
  | "MANUAL_ENTRY_WITHOUT_SLOT"
  | "DUPLICATE"
  | "AMBIGUOUS";

export const BOOK_SLOT_JUST_TAKEN_MESSAGE =
  "Ese horario acaba de ocuparse. Selecciona otro disponible." as const;

export const LIVE_SYNC_LOADING_LABEL =
  "Actualizando disponibilidad…" as const;

/** NSS / NOMBRE / ASESOR con contenido real → fila ocupada. */
export function isSheetIdentityOccupied(input: {
  nss?: string | null;
  name?: string | null;
  advisor?: string | null;
}): boolean {
  return Boolean(
    String(input.nss ?? "").trim() ||
      String(input.name ?? "").trim() ||
      String(input.advisor ?? "").trim(),
  );
}

/**
 * Clasifica una fila del Sheet (columnas A + B/C/D + P).
 * No usa NOTIFICACION. No asigna hora arbitraria si A está vacía.
 */
export function classifySheetRowOccupancy(input: {
  hora?: string | null;
  nss?: string | null;
  name?: string | null;
  advisor?: string | null;
  techBookingId?: string | null;
  techEstado?: string | null;
}): SheetOccupancyClass {
  const hora = String(input.hora ?? "").trim();
  const identity = isSheetIdentityOccupied(input);
  const bookingId = String(input.techBookingId ?? "").trim();
  const estado = String(input.techEstado ?? "").trim().toUpperCase();

  if (!hora) {
    return identity ? "MANUAL_ENTRY_WITHOUT_SLOT" : "FREE";
  }
  if (estado === "CANCELADA") return "FREE";
  if (estado === "REAGENDADO" || estado === "RESCHEDULED_HISTORY") {
    return "RESCHEDULED_HISTORY";
  }
  if (bookingId) return "OCCUPIED_CRM";
  if (identity) return "OCCUPIED_MANUAL";
  return "FREE";
}

/** Fingerprint estable sin exponer PII en logs/webhooks (hash djb2 hex). */
export function manualOccupancyFingerprint(input: {
  nss?: string | null;
  name?: string | null;
  advisor?: string | null;
}): string {
  const raw = [
    String(input.nss ?? "").trim().toUpperCase(),
    String(input.name ?? "").trim().toUpperCase(),
    String(input.advisor ?? "").trim().toUpperCase(),
  ].join("|");
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 33) ^ raw.charCodeAt(i);
  }
  return `m${(h >>> 0).toString(16)}`;
}

export type PhysicalSlotOccupancyRow = Readonly<{
  slotTime: string;
  status: "available" | "occupied_external" | "linked" | "claimed" | "disabled" | "conflict";
}>;

/**
 * available = filas físicas - ocupadas en Sheet (CRM linked/claimed cuenta 1; manual 1).
 * No doble conteo: una fila = un lugar.
 */
export function countAvailableByPhysicalOccupancy(
  rows: readonly PhysicalSlotOccupancyRow[],
  slotTime: string,
): { physicalTotal: number; occupied: number; available: number } {
  const t = String(slotTime).trim().slice(0, 5);
  const matched = rows.filter((r) => String(r.slotTime).slice(0, 5) === t);
  const physicalTotal = matched.filter((r) => r.status !== "disabled").length;
  const occupied = matched.filter((r) =>
    r.status === "occupied_external" ||
    r.status === "linked" ||
    r.status === "claimed" ||
    r.status === "conflict"
  ).length;
  return {
    physicalTotal,
    occupied,
    available: Math.max(0, physicalTotal - occupied),
  };
}

/** Hard gate: tras relectura Sheet, ¿queda al menos 1 fila FREE? */
export function decideBookHardGate(input: {
  liveAvailableForSlot: number;
}): { allow: boolean; message: string | null } {
  if (input.liveAvailableForSlot >= 1) {
    return { allow: true, message: null };
  }
  return { allow: false, message: BOOK_SLOT_JUST_TAKEN_MESSAGE };
}

/**
 * Clasificación dry-run inventario ↔ Sheet (sin repair productivo).
 */
export function classifyInventoryReconcileRow(input: {
  sheetClass: SheetOccupancyClass;
  inventoryStatus: string | null;
  inventoryBookingId: string | null;
  sheetBookingId: string | null;
  duplicateSheetBookingIds?: boolean;
  ambiguous?: boolean;
}): InventoryReconcileClass {
  if (input.ambiguous) return "AMBIGUOUS";
  if (input.duplicateSheetBookingIds) return "DUPLICATE";
  if (input.sheetClass === "MANUAL_ENTRY_WITHOUT_SLOT") {
    return "MANUAL_ENTRY_WITHOUT_SLOT";
  }
  if (input.sheetClass === "RESCHEDULED_HISTORY") {
    return "RESCHEDULED_HISTORY";
  }
  if (input.sheetClass === "ANOMALY") return "AMBIGUOUS";
  if (
    input.inventoryBookingId &&
    input.sheetClass === "FREE" &&
    !input.sheetBookingId
  ) {
    return "CRM_BOOKING_MISSING_FROM_SHEET";
  }
  if (input.sheetClass === "OCCUPIED_CRM") return "MATCHED_CRM";
  if (input.sheetClass === "OCCUPIED_MANUAL") return "MANUAL_OCCUPIED";
  if (input.sheetClass === "FREE") return "FREE";
  return "AMBIGUOUS";
}

/** Payload Apps Script → webhook: sin PII. */
export function assertWebhookPayloadHasNoPii(payload: Record<string, unknown>): {
  ok: boolean;
  forbiddenKeys: string[];
} {
  const forbidden = [
    "nss",
    "nombre",
    "name",
    "asesor",
    "advisor",
    "cliente",
    "curp",
    "telefono",
    "email",
  ];
  const keys = Object.keys(payload).map((k) => k.toLowerCase());
  const hit = forbidden.filter((f) => keys.includes(f));
  return { ok: hit.length === 0, forbiddenKeys: hit };
}
