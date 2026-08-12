/**
 * P170 — llama agenda_sheet_apply_operational_result (autoridad Postgres).
 * No decide etapas/rechazos en TypeScript.
 */
import type { OperationalResultUpsertRow } from "./operational-results.ts";

export const APPLY_BUSINESS_OUTCOMES = [
  "APPLIED",
  "NO_OP",
  "NO_APPLY",
  "LINK_MISMATCH",
  "SKIPPED_GATE",
  "SKIPPED_STAGE",
  "SKIPPED_TERMINAL",
  "REQUIRES_HUMAN_REACTIVATION",
] as const;

export type ApplyBusinessOutcome = (typeof APPLY_BUSINESS_OUTCOMES)[number];

export type ApplyOperationalResultView = {
  ok: boolean;
  outcome: string;
  fingerprint?: string | null;
  reason?: string | null;
  skippedRpc?: boolean;
  mutated?: boolean;
  etapa_actual?: number | null;
  unexpected?: boolean;
  error_message?: string | null;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function isBusiness(outcome: string): boolean {
  return (APPLY_BUSINESS_OUTCOMES as readonly string[]).includes(outcome);
}

export function shouldSkipApplyRpc(
  row: Pick<OperationalResultUpsertRow, "booking_id" | "expediente_id">,
): boolean {
  return !row.booking_id || !row.expediente_id;
}

export function buildAgendaSheetApplyRpcArgs(
  row: OperationalResultUpsertRow,
): Record<string, unknown> {
  return {
    p_organization_id: row.organization_id,
    p_spreadsheet_id: row.spreadsheet_id,
    p_sheet_id: row.sheet_id,
    p_sheet_row: row.sheet_row,
    p_booking_date: row.booking_date,
    p_kind: row.kind,
    p_location_id: row.location_id,
    p_booking_id: row.booking_id,
    p_expediente_id: row.expediente_id,
    p_biometric_result_class: row.biometric_result_class,
    p_biometric_result_raw: row.biometric_result_raw,
    p_notification_result_class: row.notification_result_class,
    p_notification_result_raw: row.notification_result_raw,
    p_signature_result_class: row.signature_result_class,
    p_signature_result_raw: row.signature_result_raw,
    p_notes_raw: row.notes_raw ?? null,
    // SQL recalcula fingerprint canónico; Edge no inventa autoridad.
    p_fingerprint: null,
  };
}

function logApplySafe(
  level: "info" | "warn",
  row: OperationalResultUpsertRow,
  view: ApplyOperationalResultView,
): void {
  const payload = {
    spreadsheet_id: row.spreadsheet_id,
    sheet_id: row.sheet_id,
    sheet_row: row.sheet_row,
    booking_id: row.booking_id,
    expediente_id: row.expediente_id,
    kind: row.kind,
    outcome: view.outcome,
    skippedRpc: view.skippedRpc ?? false,
    unexpected: view.unexpected ?? false,
  };
  if (level === "warn") console.warn("agenda_sheet_apply", payload);
  else console.info("agenda_sheet_apply", payload);
}

export function parseApplyRpcResponse(input: {
  data: unknown;
  error: { message?: string } | null;
}): ApplyOperationalResultView {
  if (input.error) {
    return {
      ok: false,
      outcome: "RPC_ERROR",
      unexpected: true,
      error_message: String(input.error.message ?? "rpc_error").slice(0, 240),
    };
  }
  const data =
    input.data && typeof input.data === "object"
      ? (input.data as Record<string, unknown>)
      : null;
  if (!data) {
    return {
      ok: false,
      outcome: "RPC_ERROR",
      unexpected: true,
      error_message: "empty_apply_response",
    };
  }
  const outcome = String(data.outcome ?? "NO_APPLY");
  const business = isBusiness(outcome);
  return {
    ok: business ? true : Boolean(data.ok),
    outcome,
    fingerprint: data.fingerprint == null ? null : String(data.fingerprint),
    reason: data.reason == null ? null : String(data.reason),
    mutated: Boolean(data.mutated),
    etapa_actual:
      data.etapa_actual == null ? null : Number(data.etapa_actual),
    unexpected: !business,
    error_message: business
      ? null
      : String(data.reason ?? "unexpected_outcome").slice(0, 240),
  };
}

/**
 * 1) skip local si P/Q null (sin tocar last_applied_*)
 * 2) RPC apply
 * Business outcomes ≠ error fatal.
 */
export async function applyOperationalResult(
  supabase: RpcClient,
  row: OperationalResultUpsertRow,
): Promise<ApplyOperationalResultView> {
  if (shouldSkipApplyRpc(row)) {
    const view: ApplyOperationalResultView = {
      ok: true,
      outcome: "NO_APPLY",
      reason: "missing_pq",
      skippedRpc: true,
      mutated: false,
      unexpected: false,
    };
    logApplySafe("info", row, view);
    return view;
  }

  const { data, error } = await supabase.rpc(
    "agenda_sheet_apply_operational_result",
    buildAgendaSheetApplyRpcArgs(row),
  );
  const view = parseApplyRpcResponse({ data, error });
  if (view.unexpected) logApplySafe("warn", row, view);
  else logApplySafe("info", row, view);
  return view;
}
