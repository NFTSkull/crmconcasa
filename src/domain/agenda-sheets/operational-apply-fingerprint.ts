/**
 * Fingerprint canónico del estado operativo Sheet (P170).
 * Debe coincidir con public.agenda_sheet_ops_fingerprint (SQL).
 * No incluye last_seen_at ni timestamps de reconcile.
 */

import { createHash } from "node:crypto";

export type AgendaSheetOpsFingerprintInput = Readonly<{
  spreadsheetId: string;
  sheetId: number;
  sheetRow: number;
  expedienteId: string | null;
  bookingId: string | null;
  kind: string;
  biometricResultClass: string | null | undefined;
  biometricResultRaw: string | null | undefined;
  notificationResultClass: string | null | undefined;
  notificationResultRaw: string | null | undefined;
  signatureResultClass: string | null | undefined;
  signatureResultRaw: string | null | undefined;
  notesRaw: string | null | undefined;
}>;

function trimOrEmpty(v: string | null | undefined): string {
  return String(v ?? "").trim();
}

function classOrPending(v: string | null | undefined): string {
  const t = trimOrEmpty(v).toUpperCase();
  return t || "PENDING";
}

/**
 * MD5 hex del payload operativo estable (separador U+001F).
 */
export function agendaSheetOpsFingerprint(
  input: AgendaSheetOpsFingerprintInput,
): string {
  const parts = [
    trimOrEmpty(input.spreadsheetId),
    String(input.sheetId ?? ""),
    String(input.sheetRow ?? ""),
    trimOrEmpty(input.expedienteId),
    trimOrEmpty(input.bookingId),
    trimOrEmpty(input.kind).toLowerCase(),
    classOrPending(input.biometricResultClass),
    trimOrEmpty(input.biometricResultRaw),
    classOrPending(input.notificationResultClass),
    trimOrEmpty(input.notificationResultRaw),
    classOrPending(input.signatureResultClass),
    trimOrEmpty(input.signatureResultRaw),
    trimOrEmpty(input.notesRaw),
  ];
  return createHash("md5").update(parts.join("\u001f"), "utf8").digest("hex");
}
