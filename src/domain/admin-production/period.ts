/** Zona de negocio para cortes de periodo Admin (P081). */
export const ADMIN_BUSINESS_TIMEZONE = "America/Monterrey" as const;

export type AdminPeriodPreset = "hoy" | "semana" | "mes" | "personalizado";

export type AdminPeriodBounds = Readonly<{
  preset: AdminPeriodPreset;
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

/** Partes de calendario en America/Monterrey para un instante. */
export function zonedYmdParts(
  instant: Date,
  timeZone: string = ADMIN_BUSINESS_TIMEZONE,
): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(instant);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  if (!year || !month || !day) {
    throw new Error("No se pudo resolver la fecha en zona de negocio");
  }
  return { year, month, day };
}

export function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Interpreta YYYY-MM-DD como medianoche en America/Monterrey → ISO UTC.
 * Usa offset real del día (DST).
 */
export function monterreyDayStartToIso(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) throw new Error("Fecha inválida (YYYY-MM-DD)");
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    throw new Error("Fecha fuera de rango");
  }
  // Busca el instante UTC cuya pared en Monterrey es y-mo-d 00:00
  // Probamos candidatos alrededor de 06:00 UTC (CST/CDT).
  for (let hourUtc = 4; hourUtc <= 8; hourUtc += 1) {
    const candidate = new Date(Date.UTC(y, mo - 1, d, hourUtc, 0, 0, 0));
    const parts = zonedYmdParts(candidate);
    const wall = new Intl.DateTimeFormat("en-US", {
      timeZone: ADMIN_BUSINESS_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(candidate);
    const hh = Number(wall.find((p) => p.type === "hour")?.value);
    const mm = Number(wall.find((p) => p.type === "minute")?.value);
    if (
      parts.year === y &&
      parts.month === mo &&
      parts.day === d &&
      hh === 0 &&
      mm === 0
    ) {
      return candidate.toISOString();
    }
  }
  // Fallback: binary search minutes in the UTC day window
  const start = Date.UTC(y, mo - 1, d - 1, 18, 0, 0, 0);
  const end = Date.UTC(y, mo - 1, d, 12, 0, 0, 0);
  for (let t = start; t <= end; t += 60_000) {
    const candidate = new Date(t);
    const parts = zonedYmdParts(candidate);
    const wall = new Intl.DateTimeFormat("en-US", {
      timeZone: ADMIN_BUSINESS_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(candidate);
    const hh = Number(wall.find((p) => p.type === "hour")?.value);
    const mm = Number(wall.find((p) => p.type === "minute")?.value);
    if (
      parts.year === y &&
      parts.month === mo &&
      parts.day === d &&
      hh === 0 &&
      mm === 0
    ) {
      return candidate.toISOString();
    }
  }
  throw new Error(`No se pudo mapear ${ymd} a medianoche Monterrey`);
}

function addCalendarDays(ymd: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error("Fecha inválida");
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta));
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

function startOfMonth(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error("Fecha inválida");
  return `${m[1]}-${m[2]}-01`;
}

export function resolveAdminPeriodBounds(input: {
  preset: AdminPeriodPreset;
  /** Requerido si preset=personalizado */
  customFrom?: string;
  customToInclusive?: string;
  now?: Date;
}): AdminPeriodBounds {
  const now = input.now ?? new Date();
  const todayParts = zonedYmdParts(now);
  const today = formatYmd(todayParts.year, todayParts.month, todayParts.day);

  let fromDate: string;
  let toDateInclusive: string;

  switch (input.preset) {
    case "hoy":
      fromDate = today;
      toDateInclusive = today;
      break;
    case "semana":
      fromDate = startOfWeekMonday(today);
      toDateInclusive = today;
      break;
    case "mes":
      fromDate = startOfMonth(today);
      toDateInclusive = today;
      break;
    case "personalizado": {
      fromDate = (input.customFrom ?? "").trim();
      toDateInclusive = (input.customToInclusive ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDateInclusive)) {
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
  const toExclusiveIso = monterreyDayStartToIso(addCalendarDays(toDateInclusive, 1));

  return {
    preset: input.preset,
    fromIso,
    toExclusiveIso,
    fromDate,
    toDateInclusive,
  };
}

export function isInstantInPeriod(
  iso: string | null | undefined,
  bounds: AdminPeriodBounds,
): boolean {
  if (!iso?.trim()) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const from = Date.parse(bounds.fromIso);
  const toEx = Date.parse(bounds.toExclusiveIso);
  return t >= from && t < toEx;
}

/** Umbral estricto para KPI “aprobadas mayores a $20,000”. */
export const ADMIN_MONTO_MAYOR_A = 20_000;

export function isMontoMayorA20000(monto: number | null | undefined): boolean {
  return typeof monto === "number" && Number.isFinite(monto) && monto > ADMIN_MONTO_MAYOR_A;
}
