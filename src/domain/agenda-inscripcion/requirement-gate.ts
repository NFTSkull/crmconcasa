/**
 * Gate puro P175 — ¿puede Edge intentar crear requirement desde ops?
 * Independiente de P170 OPERATIONAL_APPLY_*.
 */

import {
  GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED,
  GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE,
} from "./constants";
import { parseInscripcionRequirementsFromDate } from "./env-gate";

export type InscripcionRequirementsConfig = {
  enabled: boolean;
  fromDate: string | null;
};

export type InscripcionRequirementGateOutcome =
  | "DISABLED"
  | "DISABLED_NO_CUTOVER"
  | "BEFORE_CUTOVER"
  | "NOT_REQUIRED"
  | "MISSING_IDENTITY"
  | "CREATABLE";

export type InscripcionRequirementGateResult = {
  allow: boolean;
  outcome: InscripcionRequirementGateOutcome;
  enabled: boolean;
  fromDate: string | null;
};

export type InscripcionRequirementOpsRow = {
  kind?: string | null;
  biometric_result_class?: string | null;
  inscripcion_rebook_required?: boolean | null;
  booking_id?: string | null;
  expediente_id?: string | null;
  organization_id?: string | null;
  booking_date?: string | null;
  sheet_id?: number | null;
  sheet_row?: number | null;
};

function isTruthyEnvFlag(raw: string | null | undefined): boolean {
  const t = String(raw ?? "").trim().toLowerCase();
  return t === "true" || t === "1" || t === "yes" || t === "on";
}

export function getInscripcionRequirementsConfig(
  env: Record<string, string | undefined> = {},
): InscripcionRequirementsConfig {
  const enabled = isTruthyEnvFlag(
    env[GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED],
  );
  const fromDate = parseInscripcionRequirementsFromDate(
    env[GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE],
  );
  return { enabled, fromDate };
}

/**
 * Evalúa si la fila ops es candidata a RPC require_from_sheet.
 * SQL sigue siendo autoridad; esto es prefiltro Edge fail-closed.
 */
export function evaluateInscripcionRequirementGate(input: {
  config: InscripcionRequirementsConfig;
  row: InscripcionRequirementOpsRow;
}): InscripcionRequirementGateResult {
  const { config, row } = input;
  if (!config.enabled) {
    return {
      allow: false,
      outcome: "DISABLED",
      enabled: false,
      fromDate: config.fromDate,
    };
  }
  if (!config.fromDate) {
    return {
      allow: false,
      outcome: "DISABLED_NO_CUTOVER",
      enabled: true,
      fromDate: null,
    };
  }
  const booking = parseInscripcionRequirementsFromDate(row.booking_date);
  if (!booking) {
    return {
      allow: false,
      outcome: "DISABLED_NO_CUTOVER",
      enabled: true,
      fromDate: config.fromDate,
    };
  }
  if (booking < config.fromDate) {
    return {
      allow: false,
      outcome: "BEFORE_CUTOVER",
      enabled: true,
      fromDate: config.fromDate,
    };
  }
  if (String(row.kind ?? "").trim() !== "biometricos") {
    return {
      allow: false,
      outcome: "NOT_REQUIRED",
      enabled: true,
      fromDate: config.fromDate,
    };
  }
  if (String(row.biometric_result_class ?? "").trim() !== "COMPLETED") {
    return {
      allow: false,
      outcome: "NOT_REQUIRED",
      enabled: true,
      fromDate: config.fromDate,
    };
  }
  if (row.inscripcion_rebook_required !== true) {
    return {
      allow: false,
      outcome: "NOT_REQUIRED",
      enabled: true,
      fromDate: config.fromDate,
    };
  }
  const org = String(row.organization_id ?? "").trim();
  const bookingId = String(row.booking_id ?? "").trim();
  const expedienteId = String(row.expediente_id ?? "").trim();
  if (!org || !bookingId || !expedienteId) {
    return {
      allow: false,
      outcome: "MISSING_IDENTITY",
      enabled: true,
      fromDate: config.fromDate,
    };
  }
  return {
    allow: true,
    outcome: "CREATABLE",
    enabled: true,
    fromDate: config.fromDate,
  };
}
