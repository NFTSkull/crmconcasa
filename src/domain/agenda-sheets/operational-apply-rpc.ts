/**
 * Mapping Edge/domain → RPC agenda_sheet_apply_operational_result (P170+P173).
 * Postgres decide etapas/rechazos; aquí solo contrato + outcomes.
 */

import type { OperationalResultUpsertRow } from "./operational-results";
import { agendaSheetOpsFingerprint } from "./operational-apply-fingerprint";

export const APPLY_BUSINESS_OUTCOMES = [
  "APPLIED",
  "NO_OP",
  "NO_APPLY",
  "LINK_MISMATCH",
  "SKIPPED_GATE",
  "SKIPPED_STAGE",
  "SKIPPED_TERMINAL",
  "REQUIRES_HUMAN_REACTIVATION",
  "COLOR_VETO",
  "SKIPPED_CONTINGENCY",
] as const;

export type ApplyBusinessOutcome = (typeof APPLY_BUSINESS_OUTCOMES)[number];

export type AgendaSheetApplyRpcArgs = Readonly<{
  p_organization_id: string;
  p_spreadsheet_id: string;
  p_sheet_id: number;
  p_sheet_row: number;
  p_booking_date: string;
  p_kind: string;
  p_location_id: string;
  p_booking_id: string | null;
  p_expediente_id: string | null;
  p_biometric_result_class: string;
  p_biometric_result_raw: string | null;
  p_notification_result_class: string;
  p_notification_result_raw: string | null;
  p_signature_result_class: string;
  p_signature_result_raw: string | null;
  p_notes_raw: string | null;
  p_biometric_cell_red: boolean;
  p_notification_cell_red: boolean;
  p_signature_cell_red: boolean;
  p_operational_red_veto: boolean;
  p_fingerprint: string;
}>;

export type ApplyOperationalResultView = Readonly<{
  ok: boolean;
  outcome: ApplyBusinessOutcome | string;
  fingerprint?: string | null;
  reason?: string | null;
  skippedRpc?: boolean;
  mutated?: boolean;
  etapa_actual?: number | null;
  unexpected?: boolean;
  error_message?: string | null;
}>;

export function isApplyBusinessOutcome(raw: string): raw is ApplyBusinessOutcome {
  return (APPLY_BUSINESS_OUTCOMES as readonly string[]).includes(raw);
}

/** Evita RPC cuando P/Q claramente ausentes (Postgres seguiría siendo NO_APPLY). */
export function shouldSkipApplyRpc(
  row: Pick<OperationalResultUpsertRow, "booking_id" | "expediente_id">,
): boolean {
  return !row.booking_id || !row.expediente_id;
}

export function buildAgendaSheetApplyRpcArgs(
  row: OperationalResultUpsertRow,
): AgendaSheetApplyRpcArgs {
  const fingerprint = agendaSheetOpsFingerprint({
    spreadsheetId: row.spreadsheet_id,
    sheetId: row.sheet_id,
    sheetRow: row.sheet_row,
    expedienteId: row.expediente_id,
    bookingId: row.booking_id,
    kind: row.kind,
    biometricResultClass: row.biometric_result_class,
    biometricResultRaw: row.biometric_result_raw,
    notificationResultClass: row.notification_result_class,
    notificationResultRaw: row.notification_result_raw,
    signatureResultClass: row.signature_result_class,
    signatureResultRaw: row.signature_result_raw,
    notesRaw: row.notes_raw ?? null,
    biometricCellRed: Boolean(row.biometric_cell_red),
    notificationCellRed: Boolean(row.notification_cell_red),
    signatureCellRed: Boolean(row.signature_cell_red),
    operationalRedVeto: Boolean(row.operational_red_veto),
  });
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
    p_biometric_cell_red: Boolean(row.biometric_cell_red),
    p_notification_cell_red: Boolean(row.notification_cell_red),
    p_signature_cell_red: Boolean(row.signature_cell_red),
    p_operational_red_veto: Boolean(row.operational_red_veto),
    p_fingerprint: fingerprint,
  };
}

export function localNoApplyUnlinked(
  row: Pick<
    OperationalResultUpsertRow,
    "spreadsheet_id" | "sheet_id" | "sheet_row" | "booking_id" | "expediente_id"
  >,
): ApplyOperationalResultView {
  return {
    ok: true,
    outcome: "NO_APPLY",
    reason: "missing_pq",
    skippedRpc: true,
    fingerprint: null,
    mutated: false,
    unexpected: false,
  };
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
  const business = isApplyBusinessOutcome(outcome);
  return {
    ok: business ? true : Boolean(data.ok),
    outcome,
    fingerprint:
      data.fingerprint == null ? null : String(data.fingerprint),
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
