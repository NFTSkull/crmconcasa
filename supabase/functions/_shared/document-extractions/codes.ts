/**
 * P3 — códigos de error seguros (sin PII) para document extractions worker.
 */

export const DOCUMENT_EXTRACTION_ERROR_CODES = [
  "feature_off",
  "unsupported_provider",
  "document_not_current",
  "document_not_found",
  "storage_missing",
  "storage_download_failed",
  "provider_failed",
  "lease_expired",
  "complete_conflict",
  "internal_error",
  "auth_failed",
  "invalid_args",
] as const;

export type DocumentExtractionErrorCode =
  (typeof DOCUMENT_EXTRACTION_ERROR_CODES)[number];

export const DOCUMENT_EXTRACTION_ALLOWED_PROVIDERS = ["shadow"] as const;

export type DocumentExtractionAllowedProvider =
  (typeof DOCUMENT_EXTRACTION_ALLOWED_PROVIDERS)[number];

export function isSupportedDocumentExtractionProvider(
  provider: string | null | undefined,
): provider is DocumentExtractionAllowedProvider {
  if (!provider) return false;
  return (DOCUMENT_EXTRACTION_ALLOWED_PROVIDERS as readonly string[]).includes(
    provider,
  );
}

export function isRetryableDocumentExtractionError(
  code: DocumentExtractionErrorCode,
): boolean {
  switch (code) {
    case "storage_download_failed":
    case "provider_failed":
    case "internal_error":
    case "lease_expired":
      return true;
    case "feature_off":
    case "unsupported_provider":
    case "document_not_current":
    case "document_not_found":
    case "storage_missing":
    case "complete_conflict":
    case "auth_failed":
    case "invalid_args":
      return false;
    default:
      return false;
  }
}

/** Vault / env names — fail-closed DEFAULT OFF. */
export const DOCUMENT_EXTRACTION_VAULT_WORKER_ENABLED =
  "document_extraction_worker_enabled" as const;
export const DOCUMENT_EXTRACTION_WORKER_SECRET_ENV =
  "DOCUMENT_EXTRACTION_WORKER_SECRET" as const;
export const DOCUMENT_EXTRACTION_WORKER_SECRET_HEADER =
  "x-concasa-doc-extraction-secret" as const;
