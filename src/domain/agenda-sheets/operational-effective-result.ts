/**
 * P180 — effective_result canónico: color + texto + contexto.
 * Autoridad del KPI Bernardo (COMPLETED_CURRENT + projection CURRENT).
 * Legacy *_result_class permanece como proyección textual (P165/P170).
 */

import { detectInscripcionRebookRequirement } from "@/domain/agenda-inscripcion/detect-rebook";
import {
  classifyOperationalColor,
  type EffectiveBackground,
  type OperationalColor,
} from "./effective-background";
import { normalizeSheetOpsText } from "./operational-result-classifiers";

export type OperationalEffectiveResult =
  | "COMPLETED_CURRENT"
  | "COMPLETED_HISTORICAL"
  | "FAILED"
  | "REBOOK_REQUIRED"
  | "PENDING"
  | "MANUAL_REVIEW";

export type OperationalProjectionStatus =
  | "CURRENT"
  | "STALE"
  | "IDENTITY_CONFLICT"
  | "UNLINKED";

export const OPERATIONAL_EFFECTIVE_RESULTS = [
  "COMPLETED_CURRENT",
  "COMPLETED_HISTORICAL",
  "FAILED",
  "REBOOK_REQUIRED",
  "PENDING",
  "MANUAL_REVIEW",
] as const satisfies readonly OperationalEffectiveResult[];

export const OPERATIONAL_PROJECTION_STATUSES = [
  "CURRENT",
  "STALE",
  "IDENTITY_CONFLICT",
  "UNLINKED",
] as const satisfies readonly OperationalProjectionStatus[];

const BIOMETRIC_POSITIVE_EXACT = new Set([
  "CESI MTY",
  "CESI APODACA",
  "YA EN CESI",
]);

const FAILED_EXACT = new Set(["X", "NO", "NO ASISTIO", "NO FIRMO"]);

/** Firmas / notif positivas auditadas (B0). */
function isBettyFamilyPositive(n: string): boolean {
  if (!n) return false;
  if (n === "SI") return true;
  if (n === "YA CON BETTY") return true;
  if (/^YA CON BETTY(\s+\d+)?$/.test(n)) return true;
  if (/^BETTY(\s+\d+)?$/.test(n)) return true;
  return false;
}

function isBiometricPositiveText(n: string): boolean {
  if (!n) return false;
  if (BIOMETRIC_POSITIVE_EXACT.has(n)) return true;
  // Variante estrecha: contiene CESI sin X embebido.
  if (/\bCESI\b/.test(n) && !/\bX\b/.test(n)) return true;
  return false;
}

function combinedContextText(parts: Array<string | null | undefined>): string {
  return normalizeSheetOpsText(parts.filter(Boolean).join(" | "));
}

/** Fechas auxiliares en G u notas (patrones B0: "10 agosto", "12/08", "31 julio"). */
function hasHistoricalDateSignal(n: string): boolean {
  if (!n) return false;
  if (
    /\b\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\b/.test(n)
  ) {
    return true;
  }
  if (
    /\b\d{1,2}\s+(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC|ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\b/.test(
      n,
    )
  ) {
    return true;
  }
  return false;
}

function hasHistoricalBioSignal(n: string): boolean {
  if (!n) return false;
  if (n.includes("TENIA BIOMETRICOS")) return true;
  if (n.includes("TIENE BIOMETRICOS")) return true;
  if (n.includes("TOMO BIOMETRICOS")) return true;
  if (n.includes("SOLO INSCRIPCION")) return true;
  if (n.includes("AGEND") && n.includes("MAL")) return true;
  if (hasHistoricalDateSignal(n)) return true;
  return false;
}

function hasRebookSignal(n: string, rawForInscripcion?: string | null): boolean {
  if (detectInscripcionRebookRequirement(rawForInscripcion ?? n)) return true;
  if (!n) return false;
  if (n.includes("REAGENDA")) return true;
  if (n.includes("FALLA DE SISTEMA") || n.includes("FALLAS EN EL SISTEMA")) {
    return true;
  }
  if (n.includes("SE RETIRO POR FALLA")) return true;
  return false;
}

/**
 * Señales sin regla de negocio certificada → MANUAL_REVIEW (fail-closed).
 * No convierten verde+CESI limpio en review.
 */
function hasAmbiguousManualSignal(n: string): boolean {
  if (!n) return false;
  if (n.includes("ESTADO DE CUENTA")) return true;
  if (n.includes("BURO")) return true;
  if (n.includes("FALTAN FOTOS")) return true;
  if (n.includes("NO TRAE TURNO")) return true;
  if (n.includes("NO PASARON HUELLAS")) return true;
  if (n.includes("CLIENTE NO QUISO")) return true;
  if (n.includes("EMPRESA NO AUTORIZ")) return true;
  if (n.includes("PRECALIFICACION")) return true;
  if (n.includes("LEVANTARON CASO")) return true;
  // "SE RETIRO" sin falla de sistema ya cubierta en rebook.
  if (n.includes("SE RETIRO") && !n.includes("FALLA")) return true;
  return false;
}

function resolveNegativeOrConflict(input: {
  color: OperationalColor;
  positiveText: boolean;
  failedText: boolean;
  rebook: boolean;
  historical: boolean;
  ambiguous: boolean;
  empty: boolean;
}): OperationalEffectiveResult {
  const { color, positiveText, failedText, rebook, historical, ambiguous, empty } =
    input;

  if (empty) {
    // Template naranja vacío (inscripción) u operativo vacío.
    if (color === "ORANGE" || color === "OTHER" || color === "UNKNOWN") {
      return "PENDING";
    }
    if (color === "RED") return "PENDING";
    if (color === "GREEN") return "PENDING";
  }

  if (rebook) return "REBOOK_REQUIRED";

  // Color no positivo nunca produce COMPLETED_CURRENT.
  if (color === "RED" || color === "ORANGE") {
    if (positiveText) return "MANUAL_REVIEW";
    if (failedText) return "FAILED";
    if (ambiguous || historical) return "MANUAL_REVIEW";
    return "MANUAL_REVIEW";
  }

  if (color === "OTHER" || color === "UNKNOWN") {
    if (positiveText || failedText || historical || ambiguous || !empty) {
      return "MANUAL_REVIEW";
    }
    return "PENDING";
  }

  // GREEN
  if (historical && positiveText) return "COMPLETED_HISTORICAL";
  if (historical) return "MANUAL_REVIEW";
  if (ambiguous) return "MANUAL_REVIEW";
  if (positiveText) return "COMPLETED_CURRENT";
  if (failedText) return "MANUAL_REVIEW"; // verde + X = conflicto
  return "MANUAL_REVIEW";
}

export type EffectiveResultInput = Readonly<{
  color: OperationalColor;
  raw: string | null | undefined;
  notes?: string | null | undefined;
  /** Col G u otra auxiliar (fechas / FIRMA). */
  auxText?: string | null | undefined;
  /** Bloque bajo encabezado REAGENDADOS… */
  inReagendadosBlock?: boolean;
}>;

export function deriveBiometricEffectiveResult(
  input: EffectiveResultInput,
): OperationalEffectiveResult {
  const rawN = normalizeSheetOpsText(input.raw);
  const ctx = combinedContextText([
    input.notes,
    input.auxText,
    input.inReagendadosBlock ? "REAGENDADOS" : "",
  ]);
  const empty = !rawN;
  return resolveNegativeOrConflict({
    color: input.color,
    positiveText: isBiometricPositiveText(rawN),
    failedText: FAILED_EXACT.has(rawN) || rawN.includes("NO ASIST"),
    rebook: hasRebookSignal(ctx, input.raw) || hasRebookSignal(rawN),
    historical:
      Boolean(input.inReagendadosBlock) ||
      hasHistoricalBioSignal(ctx) ||
      hasHistoricalBioSignal(rawN),
    ambiguous: hasAmbiguousManualSignal(ctx),
    empty,
  });
}

export function deriveNotificationEffectiveResult(
  input: EffectiveResultInput,
): OperationalEffectiveResult {
  const rawN = normalizeSheetOpsText(input.raw);
  const ctx = combinedContextText([
    input.notes,
    input.auxText,
    input.inReagendadosBlock ? "REAGENDADOS" : "",
  ]);
  const empty = !rawN;

  // P175: REAGENDA INSCRIP* → rebook, no FAILED.
  if (detectInscripcionRebookRequirement(input.raw)) {
    return "REBOOK_REQUIRED";
  }

  return resolveNegativeOrConflict({
    color: input.color,
    positiveText: isBettyFamilyPositive(rawN),
    failedText: FAILED_EXACT.has(rawN) || rawN.includes("NO ASIST"),
    rebook: hasRebookSignal(ctx) || hasRebookSignal(rawN),
    historical:
      Boolean(input.inReagendadosBlock) || hasHistoricalBioSignal(ctx),
    ambiguous: hasAmbiguousManualSignal(ctx),
    empty,
  });
}

export function deriveSignatureEffectiveResult(
  input: EffectiveResultInput & {
    /** Col G FIRMA — contexto, no reemplaza F. */
    firmaAux?: string | null | undefined;
  },
): OperationalEffectiveResult {
  const rawN = normalizeSheetOpsText(input.raw);
  const ctx = combinedContextText([
    input.notes,
    input.firmaAux ?? input.auxText,
    input.inReagendadosBlock ? "REAGENDADOS" : "",
  ]);
  const empty = !rawN;

  return resolveNegativeOrConflict({
    color: input.color,
    positiveText: isBettyFamilyPositive(rawN) || rawN === "SI",
    failedText:
      FAILED_EXACT.has(rawN) ||
      rawN.includes("NO ASIST") ||
      rawN.includes("NO FIRMO"),
    rebook: hasRebookSignal(ctx) || hasRebookSignal(rawN),
    historical: Boolean(input.inReagendadosBlock),
    ambiguous: hasAmbiguousManualSignal(ctx),
    empty,
  });
}

export function colorFromEiCell(
  eiBackgrounds: ReadonlyArray<EffectiveBackground> | null | undefined,
  index: number,
): OperationalColor {
  if (eiBackgrounds == null) return "UNKNOWN";
  return classifyOperationalColor(eiBackgrounds[index] ?? null);
}

export function operationalEffectiveResultLabel(
  r: OperationalEffectiveResult,
): string {
  switch (r) {
    case "COMPLETED_CURRENT":
      return "Completado hoy";
    case "COMPLETED_HISTORICAL":
      return "Completado (histórico)";
    case "FAILED":
      return "No realizado";
    case "REBOOK_REQUIRED":
      return "Reagenda / incidencia";
    case "PENDING":
      return "Pendiente";
    default:
      return "Revisión manual";
  }
}

/** KPI day-count: solo COMPLETED_CURRENT. */
export function isCompletedCurrentEffective(
  r: OperationalEffectiveResult | null | undefined,
): boolean {
  return r === "COMPLETED_CURRENT";
}
