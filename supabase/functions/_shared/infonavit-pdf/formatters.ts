/**
 * Formatters puros P189 — sin locale implícito del runtime / sin Date.now().
 */

import { InfonavitPdfError } from "./errors.ts";

const MESES_ES_MAYUS = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
] as const;

export interface ParsedYmd {
  year: number;
  month: number;
  day: number;
}

/** Parsea YYYY-MM-DD sin timezone. */
export function parseYmd(ymd: string): ParsedYmd {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) {
    throw new InfonavitPdfError(
      "INFONAVIT_INVALID_DATE",
      "fechaDocumento debe ser YYYY-MM-DD",
      { reason: "bad_format" },
    );
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new InfonavitPdfError(
      "INFONAVIT_INVALID_DATE",
      "fechaDocumento fuera de rango",
      { reason: "out_of_range" },
    );
  }
  // Validación calendario simple (no TZ).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new InfonavitPdfError(
      "INFONAVIT_INVALID_DATE",
      "fechaDocumento no es un día válido",
      { reason: "invalid_calendar_day" },
    );
  }
  return { year, month, day };
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Bajo protesta: día 2 dígitos, mes 2 dígitos, año 2 dígitos. */
export function formatBajoProtestaDateParts(ymd: string): {
  day: string;
  month: string;
  year2: string;
} {
  const { year, month, day } = parseYmd(ymd);
  return {
    day: pad2(day),
    month: pad2(month),
    year2: pad2(year % 100),
  };
}

/** Solicitud cierre: día 2 dígitos, mes nombre ES mayúsculas, año 2 dígitos. */
export function formatSolicitudCierreDateParts(ymd: string): {
  day: string;
  monthName: string;
  year2: string;
} {
  const { year, month, day } = parseYmd(ymd);
  return {
    day: pad2(day),
    monthName: MESES_ES_MAYUS[month - 1]!,
    year2: pad2(year % 100),
  };
}

/**
 * Presupuesto fecha corta (campo angosto ~68pt): DD/MM/AA.
 */
export function formatPresupuestoFecha(ymd: string): string {
  const { year, month, day } = parseYmd(ymd);
  return `${pad2(day)}/${pad2(month)}/${pad2(year % 100)}`;
}

/**
 * Monto determinista: 1,234.56 (coma miles, punto decimales).
 * Acepta number finito; convierte vía centavos enteros.
 * `withSymbol: true` → `$1,234.56`. Plantillas Presupuesto/Solicitud ya
 * imprimen `$` estático → usar `withSymbol: false` allí.
 */
export function formatMoneyMx(
  amount: number,
  opts?: { withSymbol?: boolean },
): string {
  if (!Number.isFinite(amount)) {
    throw new InfonavitPdfError(
      "INFONAVIT_INVALID_AMOUNT",
      "monto no finito",
      { reason: "not_finite" },
    );
  }
  if (amount < 0) {
    throw new InfonavitPdfError(
      "INFONAVIT_INVALID_AMOUNT",
      "monto negativo",
      { reason: "negative" },
    );
  }
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new InfonavitPdfError(
      "INFONAVIT_INVALID_AMOUNT",
      "monto fuera de rango seguro",
      { reason: "unsafe_integer" },
    );
  }
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracStr = frac < 10 ? `0${frac}` : String(frac);
  const sign = neg ? "-" : "";
  const body = `${sign}${wholeStr}.${fracStr}`;
  return opts?.withSymbol ? `$${body}` : body;
}

/** Nombre legal mexicano típico: apellidos + nombres. */
export function formatNombreCompleto(parts: {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
}): string {
  return [parts.apellidoPaterno, parts.apellidoMaterno, parts.nombres]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normaliza blank: null/undefined → ""; trim; colapsa espacios internos opcionales. */
export function blankable(
  value: string | null | undefined,
  opts?: { collapseSpaces?: boolean },
): string {
  if (value === null || value === undefined) return "";
  let s = String(value).trim();
  if (opts?.collapseSpaces) s = s.replace(/\s+/g, " ");
  return s;
}
