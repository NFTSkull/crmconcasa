/**
 * Kill switch P175 — crear requisitos Sheet fail-closed.
 * Independiente de GOOGLE_SHEETS_OPERATIONAL_APPLY_*.
 */

import {
  GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED,
  GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE,
} from "./constants";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isTruthyEnvFlag(raw: string | null | undefined): boolean {
  const t = String(raw ?? "").trim().toLowerCase();
  return t === "true" || t === "1" || t === "yes" || t === "on";
}

/** YYYY-MM-DD calendario real, o null. */
export function parseInscripcionRequirementsFromDate(
  raw: string | null | undefined,
): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  const m = YMD_RE.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * false a menos que ENABLED sea truthy y FROM_DATE sea ISO date válida.
 * Ausente / inválido → fail-closed.
 */
export function isInscripcionRequirementsEnabled(
  env: Record<string, string | undefined> = {},
): boolean {
  if (!isTruthyEnvFlag(env[GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED])) {
    return false;
  }
  return (
    parseInscripcionRequirementsFromDate(
      env[GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE],
    ) != null
  );
}
