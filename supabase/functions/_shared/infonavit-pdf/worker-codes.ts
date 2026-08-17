/**
 * Códigos persistidos en outbox.last_error_code. Sin exception.message / PII.
 */

export const INFONAVIT_WORKER_ERROR_CODES = [
  "AUTH_FAILED",
  "OUTBOX_NOT_FOUND",
  "SNAPSHOT_NOT_FOUND",
  "SNAPSHOT_CONTRACT_INVALID",
  "SNAPSHOT_HASH_MISMATCH",
  "TEMPLATE_CONTRACT_MISMATCH",
  "PDF_GENERATION_FAILED",
  "PDF_VALIDATION_FAILED",
  "STORAGE_UPLOAD_FAILED",
  "DOCUMENT_REGISTER_FAILED",
] as const;

export type InfonavitWorkerErrorCode =
  (typeof INFONAVIT_WORKER_ERROR_CODES)[number];

export const NON_RETRYABLE_WORKER_CODES: ReadonlySet<InfonavitWorkerErrorCode> =
  new Set([
    "AUTH_FAILED",
    "OUTBOX_NOT_FOUND",
    "SNAPSHOT_NOT_FOUND",
    "SNAPSHOT_CONTRACT_INVALID",
    "SNAPSHOT_HASH_MISMATCH",
    "TEMPLATE_CONTRACT_MISMATCH",
    "PDF_VALIDATION_FAILED",
  ]);

export function isRetryableWorkerCode(code: InfonavitWorkerErrorCode): boolean {
  return !NON_RETRYABLE_WORKER_CODES.has(code);
}

export function sanitizeWorkerErrorCode(raw: string): InfonavitWorkerErrorCode {
  const code = raw.trim().toUpperCase();
  if (
    (INFONAVIT_WORKER_ERROR_CODES as readonly string[]).includes(code)
  ) {
    return code as InfonavitWorkerErrorCode;
  }
  return "PDF_GENERATION_FAILED";
}
