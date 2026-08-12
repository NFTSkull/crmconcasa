/**
 * P170 B2.5 — Kill switch + cutover date (fail-closed).
 * Solo controla si Edge invoca agenda_sheet_apply_operational_result.
 * No afecta P165 / inventory / bookings.
 */

export type OperationalApplyConfig = Readonly<{
  enabled: boolean;
  fromDate: string | null;
}>;

export type OperationalApplyGateOutcome =
  | "DISABLED"
  | "DISABLED_NO_CUTOVER"
  | "BEFORE_CUTOVER"
  | "ALLOWED";

export type OperationalApplyGateResult = Readonly<{
  allow: boolean;
  outcome: OperationalApplyGateOutcome;
  enabled: boolean;
  fromDate: string | null;
}>;

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD calendario real, o null. */
export function parseOperationalApplyFromDate(
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

export function isOperationalApplyEnabledFlag(
  raw: string | null | undefined,
): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

/**
 * Lee env (mapa inyectable en tests).
 * enabled solo con exacto "true" (case-insensitive). Ausente → false.
 * fromDate inválida → null.
 */
export function getOperationalApplyConfig(
  env: Record<string, string | undefined> = {},
): OperationalApplyConfig {
  const enabled = isOperationalApplyEnabledFlag(
    env.GOOGLE_SHEETS_OPERATIONAL_APPLY_ENABLED,
  );
  const fromDate = parseOperationalApplyFromDate(
    env.GOOGLE_SHEETS_OPERATIONAL_APPLY_FROM_DATE,
  );
  return { enabled, fromDate };
}

/**
 * Fail-closed:
 * - disabled → DISABLED
 * - enabled sin fromDate válida → DISABLED_NO_CUTOVER (no apply)
 * - booking_date < fromDate → BEFORE_CUTOVER
 * - else ALLOWED
 *
 * Autoridad de alcance = booking_date (tab), no editedAt.
 */
export function evaluateOperationalApplyGate(input: {
  config: OperationalApplyConfig;
  bookingDate: string | null | undefined;
}): OperationalApplyGateResult {
  const { config } = input;
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
  const booking = parseOperationalApplyFromDate(input.bookingDate);
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
  return {
    allow: true,
    outcome: "ALLOWED",
    enabled: true,
    fromDate: config.fromDate,
  };
}
