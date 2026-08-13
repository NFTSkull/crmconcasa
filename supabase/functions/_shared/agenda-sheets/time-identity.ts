/**
 * P174 — Identidad de hora Sheet (columna A) vs metadata.
 * Mirror Edge del domain. No muta A / booking_time / aliases.
 */

function normalizeHhMm(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

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

export function extractSheetTimeFromSlotKey(
  slotKey: string | null | undefined,
): string | null {
  const raw = String(slotKey ?? "");
  const m = raw.match(/\|sheet=([0-9]{1,2}:[0-9]{2})(?:\||$)/i);
  if (!m) return null;
  return normalizeHhMm(m[1]);
}

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

export function shouldSkipApplyForTimeIdentity(input: {
  visibleSheetTime: string | null | undefined;
  liveSlotKey: string | null | undefined;
}): boolean {
  return classifySheetTimeIdentity(input).conflict;
}
