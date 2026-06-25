import type { AgendaBiometricosWeeklyConfig } from "./map-agenda-config";
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

function parseYmd(dateYmd: YmdDate): { y: number; mo: number; d: number } {
  const [y, mo, d] = dateYmd.split("-").map(Number);
  return { y, mo, d };
}

function formatYmd(y: number, mo: number, d: number): YmdDate {
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` as YmdDate;
}

function addDaysYmd(dateYmd: YmdDate, days: number): YmdDate {
  const { y, mo, d } = parseYmd(dateYmd);
  const base = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return formatYmd(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

function normalizeHhmm(time: string): HhmmTime | null {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return null;
  return `${m[1]}:${m[2]}` as HhmmTime;
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
    if (row.bookingDate !== date) continue;
    if (row.locationId !== locationId) continue;
    const rowTime = normalizeHhmm(row.bookingTime);
    if (rowTime !== time) continue;
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
 * Disponibilidad por fecha/sede según config semanal canónica y bookings `booked` visibles vía RLS.
 */
export function computeWeeklySlotAvailability(params: {
  config: AgendaBiometricosWeeklyConfig;
  bookedSlots: readonly WeeklyBookedSlot[];
  date: YmdDate;
  locationId: string;
  now?: Date;
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
    const capacity = Math.max(1, Math.trunc(location.capacityPerSlot || 1));
    const bookedCount = countBookedForSlot(bookedSlots, date, locationId, time);
    const remaining = Math.max(0, capacity - bookedCount);
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
