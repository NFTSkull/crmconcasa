/**
 * P174 — Identidad de hora Sheet (columna A) vs metadata.
 * No muta A, booking_time ni aliases. Solo clasifica / decide skip de apply.
 */

import { normalizeHhMm } from "./time-aliases";

export const SKIPPED_TIME_IDENTITY_CONFLICT = "SKIPPED_TIME_IDENTITY_CONFLICT" as const;

export type SheetTimeIdentityClass =
  | "OK"
  | "MISSING_VISIBLE"
  | "MISSING_SLOT_KEY_SHEET"
  | "TIME_IDENTITY_CONFLICT";

export type SheetTimeIdentityVerdict = Readonly<{
  class: SheetTimeIdentityClass;
  visibleSheetTime: string | null;
  slotKeySheetTime: string | null;
  conflict: boolean;
}>;

/** Extrae `sheet=HH:mm` de CRM_SLOT_KEY (col R). */
export function extractSheetTimeFromSlotKey(
  slotKey: string | null | undefined,
): string | null {
  const raw = String(slotKey ?? "");
  const m = raw.match(/\|sheet=([0-9]{1,2}:[0-9]{2})(?:\||$)/i);
  if (!m) return null;
  return normalizeHhMm(m[1]);
}

/**
 * Conflicto de identidad: A visible y sheet= en R existen y difieren.
 * Alias lógico (08:30↔08:00) NO aplica aquí: comparamos solo físico.
 */
export function classifySheetTimeIdentity(input: {
  visibleSheetTime: string | null | undefined;
  liveSlotKey: string | null | undefined;
}): SheetTimeIdentityVerdict {
  const visibleSheetTime = normalizeHhMm(String(input.visibleSheetTime ?? ""));
  const slotKeySheetTime = extractSheetTimeFromSlotKey(input.liveSlotKey);
  if (!visibleSheetTime) {
    return {
      class: "MISSING_VISIBLE",
      visibleSheetTime: null,
      slotKeySheetTime,
      conflict: false,
    };
  }
  if (!slotKeySheetTime) {
    return {
      class: "MISSING_SLOT_KEY_SHEET",
      visibleSheetTime,
      slotKeySheetTime: null,
      conflict: false,
    };
  }
  if (visibleSheetTime !== slotKeySheetTime) {
    return {
      class: "TIME_IDENTITY_CONFLICT",
      visibleSheetTime,
      slotKeySheetTime,
      conflict: true,
    };
  }
  return {
    class: "OK",
    visibleSheetTime,
    slotKeySheetTime,
    conflict: false,
  };
}

/** True → apply no debe avanzar/rechazar/rollback por esta fila. */
export function shouldSkipApplyForTimeIdentity(input: {
  visibleSheetTime: string | null | undefined;
  liveSlotKey: string | null | undefined;
}): boolean {
  return classifySheetTimeIdentity(input).conflict;
}
