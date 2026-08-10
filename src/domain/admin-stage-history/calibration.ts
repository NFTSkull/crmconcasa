/**
 * Calibración semántica del Reporte histórico de etapas (P163).
 * Fuente canónica: expediente_paso_visual_transiciones (no etapa_actual/updated_at).
 * Zona: America/Monterrey, rango DATE inclusivo → [from, toExclusive) timestamptz.
 */

import type { AdminStageHistoryMovimiento } from "./types";
import { ADMIN_STAGE_HISTORY_TIMEZONE } from "./types";

/** Monterrey sin DST desde 2022: offset fijo UTC−06:00. */
export const MONTERREY_UTC_OFFSET_HOURS = -6 as const;

/**
 * Cobertura confiable de `expediente_paso_visual_transiciones` en producción.
 * Antes de esta fecha no hay trazabilidad completa; no inventar “cero movimientos”.
 */
export const ADMIN_STAGE_HISTORY_COVERAGE_FROM_YMD = "2026-07-23" as const;

export const ADMIN_STAGE_HISTORY_COVERAGE_BANNER =
  "Historial de etapas disponible con trazabilidad completa desde el 23/07/2026." as const;

export function adminStageHistoryRangeStartsBeforeCoverage(
  fechaDesdeYmd: string | null | undefined,
): boolean {
  const d = fechaDesdeYmd?.trim() || null;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d < ADMIN_STAGE_HISTORY_COVERAGE_FROM_YMD;
}

export function adminStageHistoryCoverageWarning(
  fechaDesdeYmd: string | null | undefined,
): string | null {
  if (!adminStageHistoryRangeStartsBeforeCoverage(fechaDesdeYmd)) return null;
  return (
    `${ADMIN_STAGE_HISTORY_COVERAGE_BANNER} ` +
    `El rango inicia antes (${fechaDesdeYmd}); la parte anterior a esa fecha no tiene cobertura histórica completa.`
  );
}

export type StageVisitInterval = Readonly<{
  enteredAtMs: number;
  /** null = sigue en la etapa */
  exitedAtMs: number | null;
  paso: number;
  nextPaso: number | null;
}>;

export type HalfOpenRange = Readonly<{
  fromMs: number;
  toExclusiveMs: number;
}>;

/**
 * Interpreta YYYY-MM-DD de negocio America/Monterrey como bounds semiabiertos.
 * Desde D / Hasta H → [D 00:00 Monterrey, (H+1) 00:00 Monterrey).
 */
export function monterreyDateRangeToHalfOpenUtcMs(
  fechaDesdeYmd: string,
  fechaHastaYmd: string,
): HalfOpenRange {
  const fromMs = ymdMonterreyMidnightToUtcMs(fechaDesdeYmd);
  const toExclusiveMs = ymdMonterreyMidnightToUtcMs(addOneCalendarDayYmd(fechaHastaYmd));
  return { fromMs, toExclusiveMs };
}

export function ymdMonterreyMidnightToUtcMs(ymd: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error(`ymd inválido: ${ymd}`);
  }
  // Medianoche Monterrey = 06:00Z (UTC−6 fijo).
  return Date.parse(`${ymd}T06:00:00.000Z`);
}

export function addOneCalendarDayYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const next = new Date(utc + 24 * 60 * 60 * 1000);
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Entraron: timestamp de entrada cae en el rango. */
export function isEntraron(visit: StageVisitInterval, range: HalfOpenRange): boolean {
  return visit.enteredAtMs >= range.fromMs && visit.enteredAtMs < range.toExclusiveMs;
}

/**
 * Avanzaron: salida hacia paso visual posterior; timestamp = exited_at real.
 * Retroceso (nextPaso < paso) NUNCA cuenta.
 */
export function isAvanzaron(visit: StageVisitInterval, range: HalfOpenRange): boolean {
  if (visit.exitedAtMs == null || visit.nextPaso == null) return false;
  if (visit.nextPaso <= visit.paso) return false;
  return visit.exitedAtMs >= range.fromMs && visit.exitedAtMs < range.toExclusiveMs;
}

/** Estuvieron: intersección intervalo_en_etapa ∩ rango ≠ ∅. */
export function isEstuvieron(visit: StageVisitInterval, range: HalfOpenRange): boolean {
  const end = visit.exitedAtMs ?? Number.POSITIVE_INFINITY;
  return visit.enteredAtMs < range.toExclusiveMs && end >= range.fromMs;
}

export function matchesMovimiento(
  movimiento: AdminStageHistoryMovimiento,
  visit: StageVisitInterval,
  range: HalfOpenRange | null,
): boolean {
  if (movimiento === "estado_actual") {
    return true; // snapshot: no usa rango de visitas
  }
  if (!range) return false;
  if (movimiento === "entrada") return isEntraron(visit, range);
  if (movimiento === "avance") return isAvanzaron(visit, range);
  return isEstuvieron(visit, range);
}

/** Duración aproximada de la estancia ∩ rango (ms). */
export function durationInRangeMs(
  visit: StageVisitInterval,
  range: HalfOpenRange,
  nowMs: number = Date.now(),
): number {
  const endRaw = visit.exitedAtMs ?? nowMs;
  const start = Math.max(visit.enteredAtMs, range.fromMs);
  const end = Math.min(endRaw, range.toExclusiveMs);
  return Math.max(0, end - start);
}

export function stillInStageAtRangeEnd(
  visit: StageVisitInterval,
  range: HalfOpenRange,
): boolean {
  return visit.exitedAtMs == null || visit.exitedAtMs >= range.toExclusiveMs;
}

export function describeAdminStageHistoryMovimiento(
  movimiento: AdminStageHistoryMovimiento,
): Readonly<{ title: string; definition: string; datesApply: boolean }> {
  switch (movimiento) {
    case "entrada":
      return {
        title: "ENTRARON",
        definition:
          "Expedientes cuya entrada a la etapa ocurrió dentro del periodo seleccionado.",
        datesApply: true,
      };
    case "avance":
      return {
        title: "AVANZARON",
        definition:
          "Expedientes cuya salida/avance desde la etapa ocurrió dentro del periodo seleccionado.",
        datesApply: true,
      };
    case "estuvieron":
      return {
        title: "ESTUVIERON",
        definition:
          "Expedientes que estuvieron en la etapa durante al menos una parte del periodo.",
        datesApply: true,
      };
    case "estado_actual":
      return {
        title: "ESTADO ACTUAL",
        definition:
          "Vista actual; no representa movimientos históricos del periodo. El rango de fechas no aplica.",
        datesApply: false,
      };
    default:
      return { title: movimiento, definition: "", datesApply: true };
  }
}

export function summarizeMovementsVsUniques(
  expedienteIds: readonly string[],
): Readonly<{ movimientos: number; expedientesUnicos: number; reingresos: number }> {
  const unicos = new Set(expedienteIds).size;
  const movimientos = expedienteIds.length;
  return {
    movimientos,
    expedientesUnicos: unicos,
    reingresos: Math.max(0, movimientos - unicos),
  };
}

export const ADMIN_STAGE_HISTORY_ASESOR_FUENTE = "actual" as const;

export function adminStageHistoryTimezoneLabel(): string {
  return ADMIN_STAGE_HISTORY_TIMEZONE;
}
