import { parseHhmmSlotInput } from "./agendaCynthiaLocations";

/** Horarios rápidos y jornada estándar Cynthia (misma lista). */
export const CYNTHIA_QUICK_SLOT_TIMES = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
] as const;

export type CynthiaQuickSlotTime = (typeof CYNTHIA_QUICK_SLOT_TIMES)[number];

export const CYNTHIA_STANDARD_WORKDAY_SLOTS: readonly CynthiaQuickSlotTime[] =
  CYNTHIA_QUICK_SLOT_TIMES;

export function sortHhmmSlotTimes(times: readonly string[]): string[] {
  return [...new Set(times)].sort();
}

export function mergeAgendaSlotTimes(
  existing: readonly string[],
  toAdd: readonly string[],
): string[] {
  const merged = new Set(existing);
  for (const raw of toAdd) {
    const parsed = parseHhmmSlotInput(raw);
    if (parsed) merged.add(parsed);
  }
  return sortHhmmSlotTimes([...merged]);
}

export type ManualSlotAttempt =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "duplicate"; slot: string }
  | { kind: "added"; slot: string; slots: string[] };

export function tryAddManualSlotTime(
  raw: string,
  existing: readonly string[],
): ManualSlotAttempt {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };
  const parsed = parseHhmmSlotInput(trimmed);
  if (!parsed) return { kind: "invalid" };
  if (existing.includes(parsed)) return { kind: "duplicate", slot: parsed };
  return {
    kind: "added",
    slot: parsed,
    slots: sortHhmmSlotTimes([...existing, parsed]),
  };
}

export function removeAgendaSlotTime(existing: readonly string[], slot: string): string[] {
  return existing.filter((s) => s !== slot);
}
