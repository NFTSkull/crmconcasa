/**
 * Edge P175 B5.1 — Sheet ops → agenda_inscripcion_require_from_sheet.
 * Independiente de P170 OPERATIONAL_APPLY_*. Fail-closed por defecto.
 */

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

export type InscripcionRequirementRuntimeOutcome =
  | InscripcionRequirementGateOutcome
  | "CREATED"
  | "IDEMPOTENT"
  | "RPC_ERROR";

export type InscripcionRequirementOpsRow = {
  kind?: string | null;
  biometric_result_class?: string | null;
  inscripcion_rebook_required?: boolean | null;
  inscripcion_rebook_reason_raw?: string | null;
  booking_id?: string | null;
  expediente_id?: string | null;
  organization_id?: string | null;
  booking_date?: string | null;
  sheet_id?: number | null;
  sheet_row?: number | null;
};

export type InscripcionRequirementResult = {
  ok: boolean;
  outcome: InscripcionRequirementRuntimeOutcome;
  attempted: boolean;
  created: boolean;
  idempotent: boolean;
  requirementId?: string | null;
  errorMessage?: string | null;
  enabled: boolean;
  fromDate: string | null;
};

// Cliente Supabase Edge: rpc() es Thenable (PostgrestFilterBuilder), no Promise estricto.
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isTruthyEnvFlag(raw: string | null | undefined): boolean {
  const t = String(raw ?? "").trim().toLowerCase();
  return t === "true" || t === "1" || t === "yes" || t === "on";
}

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

export function getInscripcionRequirementsConfig(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): InscripcionRequirementsConfig {
  const enabled = isTruthyEnvFlag(
    env.GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED,
  );
  const rawFrom = env.GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE;
  const fromDate = parseInscripcionRequirementsFromDate(rawFrom);
  if (enabled && String(rawFrom ?? "").trim() && fromDate == null) {
    console.warn("inscripcion_requirements_invalid_from_date", {
      raw: String(rawFrom ?? "").slice(0, 32),
    });
  }
  if (enabled && fromDate == null) {
    console.warn("inscripcion_requirements_fail_closed_no_cutover", {
      enabled: true,
    });
  }
  return { enabled, fromDate };
}

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

export function buildInscripcionRequireFromSheetArgs(
  row: InscripcionRequirementOpsRow,
): Record<string, unknown> {
  return {
    p_organization_id: String(row.organization_id ?? "").trim(),
    p_source_booking_id: String(row.booking_id ?? "").trim(),
    p_expediente_id: String(row.expediente_id ?? "").trim(),
    p_sheet_id: row.sheet_id ?? null,
    p_sheet_row: row.sheet_row ?? null,
    p_reason: row.inscripcion_rebook_reason_raw ?? null,
  };
}

function skippedResult(
  outcome: InscripcionRequirementGateOutcome,
  config: InscripcionRequirementsConfig,
): InscripcionRequirementResult {
  return {
    ok: true,
    outcome,
    attempted: false,
    created: false,
    idempotent: false,
    requirementId: null,
    errorMessage: null,
    enabled: config.enabled,
    fromDate: config.fromDate,
  };
}

/**
 * Prefiltro Edge + RPC service_role. No lanza por señales no aplicables.
 */
export async function maybeCreateInscripcionRequirement(
  supabase: RpcClient,
  row: InscripcionRequirementOpsRow,
  config: InscripcionRequirementsConfig = getInscripcionRequirementsConfig(),
): Promise<InscripcionRequirementResult> {
  const gate = evaluateInscripcionRequirementGate({ config, row });
  if (!gate.allow) {
    return skippedResult(gate.outcome, config);
  }

  const args = buildInscripcionRequireFromSheetArgs(row);
  try {
    const raw = await Promise.resolve(
      supabase.rpc("agenda_inscripcion_require_from_sheet", args),
    ) as { data?: unknown; error?: { message?: string } | null };
    const data = raw?.data;
    const error = raw?.error;
    if (error) {
      console.warn("inscripcion_requirement_rpc_error", {
        sheet_id: row.sheet_id,
        sheet_row: row.sheet_row,
        booking_id: row.booking_id,
        expediente_id: row.expediente_id,
        message: String(error.message ?? "").slice(0, 200),
      });
      return {
        ok: false,
        outcome: "RPC_ERROR",
        attempted: true,
        created: false,
        idempotent: false,
        requirementId: null,
        errorMessage: String(error.message ?? "rpc_error").slice(0, 240),
        enabled: config.enabled,
        fromDate: config.fromDate,
      };
    }
    const obj = (data && typeof data === "object")
      ? data as Record<string, unknown>
      : {};
    const idempotent = obj.idempotent === true;
    const requirementId = typeof obj.requirement_id === "string"
      ? obj.requirement_id
      : null;
    const created = obj.ok === true && !idempotent;
    console.info("inscripcion_requirement_rpc", {
      sheet_id: row.sheet_id,
      sheet_row: row.sheet_row,
      booking_id: row.booking_id,
      expediente_id: row.expediente_id,
      outcome: idempotent ? "IDEMPOTENT" : "CREATED",
      requirement_id: requirementId,
    });
    return {
      ok: obj.ok === true,
      outcome: idempotent ? "IDEMPOTENT" : "CREATED",
      attempted: true,
      created,
      idempotent,
      requirementId,
      errorMessage: null,
      enabled: config.enabled,
      fromDate: config.fromDate,
    };
  } catch (e) {
    const message = e instanceof Error
      ? e.message.slice(0, 240)
      : String(e).slice(0, 240);
    console.warn("inscripcion_requirement_exception", {
      sheet_id: row.sheet_id,
      sheet_row: row.sheet_row,
      booking_id: row.booking_id,
      expediente_id: row.expediente_id,
      message,
    });
    return {
      ok: false,
      outcome: "RPC_ERROR",
      attempted: true,
      created: false,
      idempotent: false,
      requirementId: null,
      errorMessage: message,
      enabled: config.enabled,
      fromDate: config.fromDate,
    };
  }
}

export type InscripcionRequirementMetrics = {
  inscripcion_requirements_enabled: boolean;
  inscripcion_requirements_from_date: string | null;
  inscripcion_requirements_attempted: number;
  inscripcion_requirements_created: number;
  inscripcion_requirements_idempotent: number;
  inscripcion_requirements_skipped: number;
  inscripcion_requirements_before_cutover: number;
  inscripcion_requirements_errors: number;
};

export function emptyInscripcionRequirementMetrics(
  config: InscripcionRequirementsConfig,
): InscripcionRequirementMetrics {
  return {
    inscripcion_requirements_enabled: config.enabled && config.fromDate != null,
    inscripcion_requirements_from_date: config.fromDate,
    inscripcion_requirements_attempted: 0,
    inscripcion_requirements_created: 0,
    inscripcion_requirements_idempotent: 0,
    inscripcion_requirements_skipped: 0,
    inscripcion_requirements_before_cutover: 0,
    inscripcion_requirements_errors: 0,
  };
}

export function accumulateInscripcionRequirementMetric(
  metrics: InscripcionRequirementMetrics,
  result: InscripcionRequirementResult,
): void {
  if (result.attempted) metrics.inscripcion_requirements_attempted += 1;
  if (result.created) metrics.inscripcion_requirements_created += 1;
  if (result.idempotent) metrics.inscripcion_requirements_idempotent += 1;
  if (result.outcome === "BEFORE_CUTOVER") {
    metrics.inscripcion_requirements_before_cutover += 1;
  }
  if (result.outcome === "RPC_ERROR") {
    metrics.inscripcion_requirements_errors += 1;
  }
  if (!result.attempted) metrics.inscripcion_requirements_skipped += 1;
}
