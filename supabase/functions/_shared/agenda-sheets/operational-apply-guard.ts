/**
 * Edge mirror: kill switch + cutover P170 B2.5 (fail-closed).
 */

export type OperationalApplyConfig = {
  enabled: boolean;
  fromDate: string | null;
};

export type OperationalApplyGateOutcome =
  | "DISABLED"
  | "DISABLED_NO_CUTOVER"
  | "BEFORE_CUTOVER"
  | "ALLOWED";

export type OperationalApplyGateResult = {
  allow: boolean;
  outcome: OperationalApplyGateOutcome;
  enabled: boolean;
  fromDate: string | null;
};

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

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

export function getOperationalApplyConfig(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): OperationalApplyConfig {
  const enabled = isOperationalApplyEnabledFlag(
    env.GOOGLE_SHEETS_OPERATIONAL_APPLY_ENABLED,
  );
  const rawFrom = env.GOOGLE_SHEETS_OPERATIONAL_APPLY_FROM_DATE;
  const fromDate = parseOperationalApplyFromDate(rawFrom);
  if (
    enabled &&
    String(rawFrom ?? "").trim() &&
    fromDate == null
  ) {
    console.warn("operational_apply_invalid_from_date", {
      raw: String(rawFrom ?? "").slice(0, 32),
    });
  }
  if (enabled && fromDate == null) {
    console.warn("operational_apply_fail_closed_no_cutover", {
      enabled: true,
    });
  }
  return { enabled, fromDate };
}

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
