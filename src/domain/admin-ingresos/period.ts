import { ADMIN_BUSINESS_TIMEZONE, formatYmd, zonedYmdParts } from "@/domain/admin-production/period";
import { monterreyDayStartToIso } from "@/domain/admin-production/period";

export type IngresosPeriodPreset =
  | "hoy"
  | "semana"
  | "mes_actual"
  | "mes_anterior"
  | "ultimos_30"
  | "personalizado"
  | "todo";

export type IngresosPeriodBounds = Readonly<{
  preset: IngresosPeriodPreset;
  fechaDesde: string | null;
  fechaHasta: string | null;
}>;

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + delta));
  return formatYmd(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

function startOfWeekMonterrey(ymd: string): string {
  // Lun=1 … Dom=0 via UTC date of YMD (approx; used for presets)
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 Sun
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDaysYmd(ymd, delta);
}

function startOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return formatYmd(y, m, 1);
}

function endOfMonth(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return formatYmd(y, m, last);
}

export function resolveIngresosPeriodBounds(params: {
  preset: IngresosPeriodPreset;
  customFrom?: string;
  customTo?: string;
  now?: Date;
}): IngresosPeriodBounds {
  const now = params.now ?? new Date();
  const parts = zonedYmdParts(now, ADMIN_BUSINESS_TIMEZONE);
  const today = formatYmd(parts.year, parts.month, parts.day);

  switch (params.preset) {
    case "todo":
      return { preset: "todo", fechaDesde: null, fechaHasta: null };
    case "hoy":
      return { preset: "hoy", fechaDesde: today, fechaHasta: today };
    case "semana": {
      const from = startOfWeekMonterrey(today);
      return { preset: "semana", fechaDesde: from, fechaHasta: today };
    }
    case "mes_actual":
      return {
        preset: "mes_actual",
        fechaDesde: startOfMonth(today),
        fechaHasta: today,
      };
    case "mes_anterior": {
      const prevMonth = parts.month === 1 ? 12 : parts.month - 1;
      const prevYear = parts.month === 1 ? parts.year - 1 : parts.year;
      const anchor = formatYmd(prevYear, prevMonth, 1);
      return {
        preset: "mes_anterior",
        fechaDesde: startOfMonth(anchor),
        fechaHasta: endOfMonth(anchor),
      };
    }
    case "ultimos_30":
      return {
        preset: "ultimos_30",
        fechaDesde: addDaysYmd(today, -29),
        fechaHasta: today,
      };
    case "personalizado": {
      const from = String(params.customFrom ?? "").trim();
      const to = String(params.customTo ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        throw new Error("Rango personalizado inválido");
      }
      if (from > to) throw new Error("La fecha inicial no puede ser mayor que la final");
      return { preset: "personalizado", fechaDesde: from, fechaHasta: to };
    }
    default:
      return {
        preset: "mes_actual",
        fechaDesde: startOfMonth(today),
        fechaHasta: today,
      };
  }
}

/** Expuesto por si se necesita ISO; las RPCs P134 usan DATE Monterrey. */
export function ingresosBoundsToIso(bounds: IngresosPeriodBounds): {
  fromIso: string | null;
  toExclusiveIso: string | null;
} {
  if (!bounds.fechaDesde || !bounds.fechaHasta) {
    return { fromIso: null, toExclusiveIso: null };
  }
  const fromIso = monterreyDayStartToIso(bounds.fechaDesde);
  const next = addDaysYmd(bounds.fechaHasta, 1);
  const toExclusiveIso = monterreyDayStartToIso(next);
  return { fromIso, toExclusiveIso };
}
