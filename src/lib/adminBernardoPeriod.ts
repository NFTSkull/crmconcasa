/**
 * Periodos del Dashboard Bernardo (B3).
 * Independientes de los filtros globales del panel Admin.
 * Zona canónica: America/Monterrey.
 */

import {
  ADMIN_BUSINESS_TIMEZONE,
  formatYmd,
  monterreyDayStartToIso,
  zonedYmdParts,
} from "@/domain/admin-production/period";

export type BernardoPeriodPreset =
  | "hoy"
  | "semana"
  | "mes"
  | "mes_pasado"
  | "personalizado";

export type BernardoPeriodBounds = Readonly<{
  preset: BernardoPeriodPreset;
  /** Inicio inclusivo (timestamptz ISO). */
  fromIso: string;
  /** Fin exclusivo (timestamptz ISO) — el UI muestra el día final inclusivo. */
  toExclusiveIso: string;
  /** Día calendario inicio YYYY-MM-DD en zona de negocio. */
  fromDate: string;
  /** Día calendario fin inclusivo YYYY-MM-DD en zona de negocio. */
  toDateInclusive: string;
}>;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function addCalendarDays(ymd: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error("Fecha inválida");
  const dt = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta),
  );
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function startOfWeekMonday(ymd: string): string {
  const iso = monterreyDayStartToIso(ymd);
  const noonProbe = new Date(Date.parse(iso) + 12 * 3600_000);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: ADMIN_BUSINESS_TIMEZONE,
    weekday: "short",
  }).format(noonProbe);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const offset = map[weekday];
  if (offset == null) throw new Error("No se pudo resolver inicio de semana");
  return addCalendarDays(ymd, -offset);
}

function endOfWeekSunday(mondayYmd: string): string {
  return addCalendarDays(mondayYmd, 6);
}

function startOfMonth(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error("Fecha inválida");
  return `${m[1]}-${m[2]}-01`;
}

function endOfMonth(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error("Fecha inválida");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return formatYmd(y, mo, last);
}

/**
 * Resuelve bounds Bernardo.
 * - Hoy: día actual completo.
 * - Esta semana: lunes → domingo (semana calendario completa).
 * - Este mes: día 1 → último día del mes actual.
 * - Mes pasado: mes calendario anterior completo.
 * - Personalizado: from/to inclusivos YYYY-MM-DD.
 */
export function resolveBernardoPeriodBounds(input: {
  preset: BernardoPeriodPreset;
  customFrom?: string;
  customToInclusive?: string;
  now?: Date;
}): BernardoPeriodBounds {
  const now = input.now ?? new Date();
  const todayParts = zonedYmdParts(now, ADMIN_BUSINESS_TIMEZONE);
  const today = formatYmd(todayParts.year, todayParts.month, todayParts.day);

  let fromDate: string;
  let toDateInclusive: string;

  switch (input.preset) {
    case "hoy":
      fromDate = today;
      toDateInclusive = today;
      break;
    case "semana": {
      fromDate = startOfWeekMonday(today);
      toDateInclusive = endOfWeekSunday(fromDate);
      break;
    }
    case "mes":
      fromDate = startOfMonth(today);
      toDateInclusive = endOfMonth(today);
      break;
    case "mes_pasado": {
      const prevMonth = todayParts.month === 1 ? 12 : todayParts.month - 1;
      const prevYear =
        todayParts.month === 1 ? todayParts.year - 1 : todayParts.year;
      const anchor = formatYmd(prevYear, prevMonth, 1);
      fromDate = startOfMonth(anchor);
      toDateInclusive = endOfMonth(anchor);
      break;
    }
    case "personalizado": {
      fromDate = (input.customFrom ?? "").trim();
      toDateInclusive = (input.customToInclusive ?? "").trim();
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(toDateInclusive)
      ) {
        throw new Error("Rango personalizado inválido");
      }
      if (fromDate > toDateInclusive) {
        throw new Error("La fecha inicial no puede ser posterior a la final");
      }
      break;
    }
    default:
      throw new Error("Preset de periodo inválido");
  }

  const fromIso = monterreyDayStartToIso(fromDate);
  const toExclusiveIso = monterreyDayStartToIso(
    addCalendarDays(toDateInclusive, 1),
  );

  return {
    preset: input.preset,
    fromIso,
    toExclusiveIso,
    fromDate,
    toDateInclusive,
  };
}

/** Etiqueta amigable del día en español (America/Monterrey). */
export function formatBernardoDayHeading(ymd: string): string {
  const iso = monterreyDayStartToIso(ymd);
  const noon = new Date(Date.parse(iso) + 12 * 3600_000);
  const raw = new Intl.DateTimeFormat("es-MX", {
    timeZone: ADMIN_BUSINESS_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(noon);
  const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1);
  return capitalized;
}

/**
 * Parte un rango inclusivo YYYY-MM-DD en ventanas ≤ maxDays
 * (límite vigente de `get_mesa_agenda_bookings`).
 */
export function chunkInclusiveDateRange(
  fromYmd: string,
  toYmdInclusive: string,
  maxDays = 62,
): ReadonlyArray<{ startDate: string; endDate: string }> {
  if (fromYmd > toYmdInclusive) return [];
  const out: { startDate: string; endDate: string }[] = [];
  let cursor = fromYmd;
  while (cursor <= toYmdInclusive) {
    const endCandidate = addCalendarDays(cursor, maxDays);
    const end = endCandidate > toYmdInclusive ? toYmdInclusive : endCandidate;
    out.push({ startDate: cursor, endDate: end });
    cursor = addCalendarDays(end, 1);
  }
  return out;
}

export function bernardoPeriodDisplayLabel(bounds: BernardoPeriodBounds): string {
  return `${bounds.fromDate} al ${bounds.toDateInclusive}`;
}

/** Solo para tests/UI: etiqueta corta del preset. */
export function bernardoPresetLabel(preset: BernardoPeriodPreset): string {
  switch (preset) {
    case "hoy":
      return "Hoy";
    case "semana":
      return "Esta semana";
    case "mes":
      return "Este mes";
    case "mes_pasado":
      return "Mes pasado";
    case "personalizado":
      return "Personalizado";
    default:
      return preset;
  }
}

export { pad2, addCalendarDays as bernardoAddCalendarDays };
