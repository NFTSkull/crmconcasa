import { z } from "zod";

export const agendaSlotCapacityKindSchema = z.enum(["biometricos", "firmas"]);
export type AgendaSlotCapacityKind = z.infer<typeof agendaSlotCapacityKindSchema>;

export const agendaSlotCapacityRowSchema = z.object({
  id: z.string().uuid(),
  kind: agendaSlotCapacityKindSchema,
  location_id: z.string().min(1),
  slot_date: z.string().min(1),
  slot_time: z.string().min(1),
  capacity: z.number().int().positive(),
  active: z.boolean(),
  occupied: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  created_at: z.string().optional().nullable(),
  updated_at: z.string().optional().nullable(),
});

export type AgendaSlotCapacityRow = z.infer<typeof agendaSlotCapacityRowSchema>;

export type AgendaSlotCapacity = Readonly<{
  id: string;
  kind: AgendaSlotCapacityKind;
  locationId: string;
  slotDate: string;
  slotTime: string;
  capacity: number;
  active: boolean;
  occupied: number;
  available: number;
}>;

export const upsertAgendaSlotCapacityResultSchema = z.object({
  ok: z.literal(true),
  id: z.string().uuid(),
  occupied: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
});

export type UpsertAgendaSlotCapacityResult = z.infer<
  typeof upsertAgendaSlotCapacityResultSchema
>;

export type UpsertAgendaSlotCapacityInput = Readonly<{
  kind: AgendaSlotCapacityKind;
  locationId: string;
  slotDate: string;
  slotTime: string;
  capacity: number;
  active: boolean;
}>;

/** Normaliza TIME SQL (`09:00:00` / `09:00`) a HH:MM. */
export function normalizeAgendaSlotTime(value: string): string {
  const trimmed = String(value ?? "").trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return trimmed.slice(0, 5);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return trimmed.slice(0, 5);
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function mapAgendaSlotCapacityRow(row: AgendaSlotCapacityRow): AgendaSlotCapacity {
  return {
    id: row.id,
    kind: row.kind,
    locationId: row.location_id,
    slotDate: String(row.slot_date).slice(0, 10),
    slotTime: normalizeAgendaSlotTime(String(row.slot_time)),
    capacity: row.capacity,
    active: row.active,
    occupied: row.occupied,
    available: row.available,
  };
}

/** Mapa hora → capacidad activa (ignora inactive). */
export function buildCapacityByTimeMap(
  rows: readonly AgendaSlotCapacity[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (!row.active) continue;
    out[row.slotTime] = row.capacity;
  }
  return out;
}

/** Horas con active=false. */
export function buildInactiveSlotTimes(
  rows: readonly AgendaSlotCapacity[],
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (!row.active) out.add(row.slotTime);
  }
  return out;
}
