import { normalizeBookingDate, normalizeBookingTime } from "@/lib/asesorAgendaCalendar";
import { bookingBelongsToAdvisorSede } from "@/lib/agendaAdvisorLocations";
import type { AdvisorSedeOption } from "@/lib/agendaAdvisorLocations";
import {
  resolveExplicitSlotCapacity,
  type AgendaBiometricosWeeklyConfig,
} from "./map-agenda-config";
import type {
  AgendaBiometricosSlotAvailability,
  HhmmTime,
  YmdDate,
} from "./types";

export type WeeklyBookedSlot = Readonly<{
  bookingDate: string;
  bookingTime: string;
  locationId: string;
}>;

/** Override opcional de cupo por hora (P118). */
export type SlotCapacityOverrides = Readonly<{
  /** HH:MM → capacidad. Si hay fila, sustituye capacityPerSlot. */
  capacityByTime?: Readonly<Record<string, number>>;
  /** Horas con active=false: se omiten o quedan llenas. */
  inactiveTimes?: ReadonlySet<string>;
  /** Si true (default), no muestra slots inactive. Si false, remaining=0. */
  hideInactive?: boolean;
}>;

function resolveSlotCapacity(
  baseCapacity: number,
  time: HhmmTime,
  overrides?: SlotCapacityOverrides | null,
): { capacity: number; skip: boolean; forceFull: boolean } {
  if (!overrides) {
    return { capacity: Math.max(1, Math.trunc(baseCapacity || 1)), skip: false, forceFull: false };
  }
  if (overrides.inactiveTimes?.has(time)) {
    if (overrides.hideInactive !== false) {
      return { capacity: 0, skip: true, forceFull: false };
    }
    return { capacity: Math.max(1, Math.trunc(baseCapacity || 1)), skip: false, forceFull: true };
  }
  const override = overrides.capacityByTime?.[time];
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return { capacity: Math.max(1, Math.trunc(override)), skip: false, forceFull: false };
  }
  return { capacity: Math.max(1, Math.trunc(baseCapacity || 1)), skip: false, forceFull: false };
}

function parseYmd(dateYmd: YmdDate): { y: number; mo: number; d: number } {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  return { y, mo, d };
}

function formatYmd(y: number, mo: number, d: number): YmdDate {
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` as YmdDate;
}

export function addDaysYmd(dateYmd: YmdDate, days: number): YmdDate {
  const { y, mo, d } = parseYmd(dateYmd);
  const base = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return formatYmd(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

function normalizeHhmm(time: string): HhmmTime | null {
  const normalized = normalizeBookingTime(time);
  return /^\d{2}:\d{2}$/.test(normalized) ? (normalized as HhmmTime) : null;
}

function normalizeYmdDate(date: string): YmdDate | null {
  const normalized = normalizeBookingDate(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? (normalized as YmdDate) : null;
}

const WEEKDAY_SHORT_TO_ISO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Convierte fecha/hora local en `timeZone` a instante UTC (ISO) compatible con RPC `book_biometricos`.
 */
export function buildScheduledAtIso(
  dateYmd: YmdDate,
  timeHhmm: HhmmTime,
  timeZone: string,
): string {
  const { y, mo, d } = parseYmd(dateYmd);
  const normalized = normalizeHhmm(timeHhmm);
  if (!normalized) {
    throw new Error("Horario inválido");
  }
  const [hh, mm] = normalized.split(":").map(Number);

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  let guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
    );
    const py = Number(parts.year);
    const pmo = Number(parts.month);
    const pd = Number(parts.day);
    const ph = Number(parts.hour);
    const pmin = Number(parts.minute);
    const displayUtc = Date.UTC(py, pmo - 1, pd, ph, pmin, 0);
    const targetUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
    guess += targetUtc - displayUtc;
  }

  return new Date(guess).toISOString();
}

/** ISODOW 1 (lun) … 7 (dom) para `dateYmd` interpretado en `timeZone`. */
export function getIsoWeekdayForDate(dateYmd: YmdDate, timeZone: string): number {
  const noonIso = buildScheduledAtIso(dateYmd, "12:00" as HhmmTime, timeZone);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(new Date(noonIso));
  return WEEKDAY_SHORT_TO_ISO[weekday] ?? 0;
}

function countBookedForSlot(
  bookedSlots: readonly WeeklyBookedSlot[],
  date: YmdDate,
  locationId: string,
  time: HhmmTime,
): number {
  let n = 0;
  for (const row of bookedSlots) {
    const rowDate = normalizeYmdDate(row.bookingDate);
    if (rowDate !== date) continue;
    if (row.locationId !== locationId) continue;
    const rowTime = normalizeHhmm(row.bookingTime);
    if (rowTime !== time) continue;
    n += 1;
  }
  return n;
}

function countBookedForAdvisorSede(
  bookedSlots: readonly WeeklyBookedSlot[],
  date: YmdDate,
  time: HhmmTime,
  sede: Pick<AdvisorSedeOption, "canonicalId" | "sourceLocationIds">,
  locations: AgendaBiometricosWeeklyConfig["locations"],
): number {
  let n = 0;
  for (const row of bookedSlots) {
    const rowDate = normalizeYmdDate(row.bookingDate);
    if (rowDate !== date) continue;
    const rowTime = normalizeHhmm(row.bookingTime);
    if (rowTime !== time) continue;
    if (!bookingBelongsToAdvisorSede(row.locationId, sede as AdvisorSedeOption, locations)) {
      continue;
    }
    n += 1;
  }
  return n;
}

function meetsMinLeadHours(
  dateYmd: YmdDate,
  timeHhmm: HhmmTime,
  timeZone: string,
  minLeadHours: number,
  now: Date,
): boolean {
  try {
    const scheduledIso = buildScheduledAtIso(dateYmd, timeHhmm, timeZone);
    const scheduledMs = new Date(scheduledIso).getTime();
    const minMs = now.getTime() + Math.max(0, minLeadHours) * 3_600_000;
    return scheduledMs > now.getTime() && scheduledMs >= minMs;
  } catch {
    return false;
  }
}

/**
 * Disponibilidad por fecha/sede según config semanal y bookings `booked` org-wide.
 */
export function computeWeeklySlotAvailability(params: {
  config: AgendaBiometricosWeeklyConfig;
  bookedSlots: readonly WeeklyBookedSlot[];
  date: YmdDate;
  locationId: string;
  now?: Date;
  capacityOverrides?: SlotCapacityOverrides | null;
}): AgendaBiometricosSlotAvailability[] {
  const { config, bookedSlots, date, locationId } = params;
  const now = params.now ?? new Date();

  if (!config.enabled) return [];

  const location = config.locations.find((l) => l.id === locationId && l.enabled);
  if (!location) return [];

  const isoDow = getIsoWeekdayForDate(date, config.timezone);
  if (!config.allowedWeekdays.includes(isoDow)) return [];

  const out: AgendaBiometricosSlotAvailability[] = [];
  for (const slot of config.slots) {
    const time = normalizeHhmm(slot);
    if (!time) continue;
    if (!meetsMinLeadHours(date, time, config.timezone, config.minLeadHours, now)) {
      continue;
    }
    const inactive = params.capacityOverrides?.inactiveTimes?.has(time) === true;
    const hideInactive = params.capacityOverrides?.hideInactive !== false;
    if (inactive && hideInactive) {
      continue;
    }
    const recurrent = resolveExplicitSlotCapacity(time, location.capacityByTime);
    const dateOverride = params.capacityOverrides?.capacityByTime?.[time];
    const hasDateOverride =
      typeof dateOverride === "number" && Number.isFinite(dateOverride) && dateOverride > 0;
    if (recurrent == null && !hasDateOverride && !(inactive && !hideInactive)) {
      continue;
    }
    const resolved = resolveSlotCapacity(recurrent ?? 1, time, params.capacityOverrides);
    if (resolved.skip) continue;
    const capacity = resolved.capacity;
    const bookedCount = countBookedForSlot(bookedSlots, date, locationId, time);
    const remaining = resolved.forceFull
      ? 0
      : Math.max(0, capacity - bookedCount);
    out.push({
      date,
      locationId,
      time,
      capacity,
      bookedCount,
      remaining,
    });
  }

  return out;
}

/** Disponibilidad consolidada para sede asesor (Monterrey/Apodaca) sumando bookings legacy. */
export function computeAdvisorSlotAvailability(params: {
  config: AgendaBiometricosWeeklyConfig;
  bookedSlots: readonly WeeklyBookedSlot[];
  date: YmdDate;
  canonicalId: string;
  sourceLocationIds: readonly string[];
  capacityPerSlot: number;
  /** Cupo recurrente por hora de la sede canónica (P123). */
  capacityByTime?: Readonly<Record<string, number>> | null;
  now?: Date;
  /** Si false, incluye horarios bloqueados solo por anticipación mínima (diagnóstico UI). */
  applyMinLeadHours?: boolean;
  capacityOverrides?: SlotCapacityOverrides | null;
}): AgendaBiometricosSlotAvailability[] {
  const { config, bookedSlots, date, canonicalId, sourceLocationIds, capacityPerSlot } = params;
  const now = params.now ?? new Date();
  const applyMinLeadHours = params.applyMinLeadHours !== false;

  if (!config.enabled) return [];
  if (!sourceLocationIds.length) return [];

  const hasEnabledSource = sourceLocationIds.some((id) =>
    config.locations.some((l) => l.id === id && l.enabled),
  );
  if (!hasEnabledSource) return [];

  const isoDow = getIsoWeekdayForDate(date, config.timezone);
  if (!config.allowedWeekdays.includes(isoDow)) return [];

  const sede: Pick<AdvisorSedeOption, "canonicalId" | "sourceLocationIds"> = {
    canonicalId: canonicalId as AdvisorSedeOption["canonicalId"],
    sourceLocationIds,
  };
  const out: AgendaBiometricosSlotAvailability[] = [];

  for (const slot of config.slots) {
    const time = normalizeHhmm(slot);
    if (!time) continue;
    if (applyMinLeadHours && !meetsMinLeadHours(date, time, config.timezone, config.minLeadHours, now)) {
      continue;
    }
    const inactive = params.capacityOverrides?.inactiveTimes?.has(time) === true;
    const hideInactive = params.capacityOverrides?.hideInactive !== false;
    if (inactive && hideInactive) {
      continue;
    }
    const recurrent = resolveExplicitSlotCapacity(time, params.capacityByTime ?? null);
    const dateOverride = params.capacityOverrides?.capacityByTime?.[time];
    const hasDateOverride =
      typeof dateOverride === "number" && Number.isFinite(dateOverride) && dateOverride > 0;
    if (recurrent == null && !hasDateOverride && !(inactive && !hideInactive)) {
      continue;
    }
    const resolved = resolveSlotCapacity(recurrent ?? 1, time, params.capacityOverrides);
    if (resolved.skip) continue;
    const capacity = resolved.capacity;
    const bookedCount = countBookedForAdvisorSede(
      bookedSlots,
      date,
      time,
      sede,
      config.locations,
    );
    const remaining = resolved.forceFull
      ? 0
      : Math.max(0, capacity - bookedCount);
    out.push({
      date,
      locationId: canonicalId,
      time,
      capacity,
      bookedCount,
      remaining,
    });
  }

  return out;
}

/** Fechas en rango con al menos un slot agendable para la sede. */
export function listBookableDatesInRange(params: {
  config: AgendaBiometricosWeeklyConfig;
  bookedSlots: readonly WeeklyBookedSlot[];
  fromDate: YmdDate;
  toDate: YmdDate;
  locationId: string;
  now?: Date;
}): YmdDate[] {
  const { config, bookedSlots, fromDate, toDate, locationId } = params;
  const out: YmdDate[] = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    const slots = computeWeeklySlotAvailability({
      config,
      bookedSlots,
      date: cursor,
      locationId,
      now: params.now,
    });
    if (slots.some((s) => s.remaining > 0)) {
      out.push(cursor);
    }
    cursor = addDaysYmd(cursor, 1);
  }
  return out;
}

export function todayYmdInTimezone(timeZone: string, now = new Date()): YmdDate {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}` as YmdDate;
}
