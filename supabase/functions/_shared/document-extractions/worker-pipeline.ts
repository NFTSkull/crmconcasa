/**
 * Shared Edge: pipeline worker shadow P3.
 */

import {
  isRetryableDocumentExtractionError,
  isSupportedDocumentExtractionProvider,
  type DocumentExtractionErrorCode,
} from "./codes.ts";
import {
  resolveDocumentExtractionProvider,
  type DocumentExtractionProviderResult,
} from "./provider.ts";

export type ClaimedExtractionJob = Readonly<{
  job_id: string;
  extraction_id: string;
  documento_id: string;
  organization_id: string;
  expediente_id: string;
  document_type: string;
  document_version: number;
  provider: string;
  provider_version: string;
  attempts: number;
  max_attempts: number;
  claimed_at: string | null;
  lease_expires_at: string | null;
}>;

export type JobMeta = Readonly<{
  ok: boolean;
  error_code?: string;
  job_id?: string;
  documento_is_current?: boolean;
  storage_bucket?: string;
  storage_path?: string;
  mime_type?: string | null;
  document_type?: string;
  document_version?: number;
  documento_id?: string;
  provider?: string;
}>;

export type WorkerProcessOutcome = Readonly<{
  job_id: string;
  outcome:
    | "done"
    | "stale"
    | "failed"
    | "dead"
    | "skipped_unsupported"
    | "skipped_not_current";
  error_code?: DocumentExtractionErrorCode;
  duration_ms: number;
}>;

export type WorkerDeps = Readonly<{
  loadMeta: (jobId: string) => Promise<JobMeta>;
  assertStorageReadable?: (meta: JobMeta) => Promise<
    | { ok: true }
    | { ok: false; error_code: DocumentExtractionErrorCode }
  >;
  complete: (args: {
    jobId: string;
    leaseClaimedAt: string | null;
    normalized: DocumentExtractionProviderResult["normalized"];
    raw: DocumentExtractionProviderResult["raw"];
  }) => Promise<{ ok: boolean; error_code?: string; status?: string }>;
  markStale: (
    jobId: string,
    reason: string,
  ) => Promise<{ ok: boolean; status?: string }>;
  markFailed: (args: {
    jobId: string;
    errorCode: DocumentExtractionErrorCode;
    retryable: boolean;
    leaseClaimedAt: string | null;
  }) => Promise<{ ok: boolean; status?: string }>;
  nowMs?: () => number;
  log?: (fields: Record<string, string | number | boolean | null>) => void;
}>;

function safeLog(
  log: WorkerDeps["log"],
  fields: Record<string, string | number | boolean | null>,
): void {
  if (!log) return;
  const allowed = new Set([
    "job_id",
    "extraction_id",
    "documento_id",
    "document_type",
    "provider",
    "status",
    "error_code",
    "duration_ms",
    "outcome",
    "attempts",
  ]);
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.has(k)) out[k] = v;
  }
  log(out);
}

export async function processClaimedExtractionJob(
  job: ClaimedExtractionJob,
  deps: WorkerDeps,
): Promise<WorkerProcessOutcome> {
  const t0 = (deps.nowMs ?? Date.now)();
  const duration = () => (deps.nowMs ?? Date.now)() - t0;

  if (!isSupportedDocumentExtractionProvider(job.provider)) {
    await deps.markFailed({
      jobId: job.job_id,
      errorCode: "unsupported_provider",
      retryable: false,
      leaseClaimedAt: job.claimed_at,
    });
    const out: WorkerProcessOutcome = {
      job_id: job.job_id,
      outcome: "skipped_unsupported",
      error_code: "unsupported_provider",
      duration_ms: duration(),
    };
    safeLog(deps.log, {
      job_id: job.job_id,
      documento_id: job.documento_id,
      document_type: job.document_type,
      provider: job.provider,
      error_code: "unsupported_provider",
      outcome: out.outcome,
      duration_ms: out.duration_ms,
    });
    return out;
  }

  const meta = await deps.loadMeta(job.job_id);
  if (!meta.ok) {
    const code = (meta.error_code ??
      "document_not_found") as DocumentExtractionErrorCode;
    await deps.markFailed({
      jobId: job.job_id,
      errorCode:
        code === "document_not_found" ? "document_not_found" : "internal_error",
      retryable: isRetryableDocumentExtractionError(
        code === "document_not_found" ? "document_not_found" : "internal_error",
      ),
      leaseClaimedAt: job.claimed_at,
    });
    return {
      job_id: job.job_id,
      outcome: "failed",
      error_code: code,
      duration_ms: duration(),
    };
  }

  if (meta.documento_is_current === false) {
    await deps.markStale(job.job_id, "document_not_current");
    const out: WorkerProcessOutcome = {
      job_id: job.job_id,
      outcome: "stale",
      error_code: "document_not_current",
      duration_ms: duration(),
    };
    safeLog(deps.log, {
      job_id: job.job_id,
      documento_id: job.documento_id,
      document_type: job.document_type,
      provider: job.provider,
      error_code: "document_not_current",
      outcome: "stale",
      duration_ms: out.duration_ms,
    });
    return out;
  }

  if (!meta.storage_path || !meta.storage_bucket) {
    await deps.markFailed({
      jobId: job.job_id,
      errorCode: "storage_missing",
      retryable: false,
      leaseClaimedAt: job.claimed_at,
    });
    return {
      job_id: job.job_id,
      outcome: "failed",
      error_code: "storage_missing",
      duration_ms: duration(),
    };
  }

  if (deps.assertStorageReadable) {
    const st = await deps.assertStorageReadable(meta);
    if (!st.ok) {
      await deps.markFailed({
        jobId: job.job_id,
        errorCode: st.error_code,
        retryable: isRetryableDocumentExtractionError(st.error_code),
        leaseClaimedAt: job.claimed_at,
      });
      return {
        job_id: job.job_id,
        outcome: "failed",
        error_code: st.error_code,
        duration_ms: duration(),
      };
    }
  }

  const provider = resolveDocumentExtractionProvider(job.provider);
  if (!provider) {
    await deps.markFailed({
      jobId: job.job_id,
      errorCode: "unsupported_provider",
      retryable: false,
      leaseClaimedAt: job.claimed_at,
    });
    return {
      job_id: job.job_id,
      outcome: "skipped_unsupported",
      error_code: "unsupported_provider",
      duration_ms: duration(),
    };
  }

  let result: DocumentExtractionProviderResult;
  try {
    result = await provider.extract({
      documentType: job.document_type,
      documentId: job.documento_id,
      documentVersion: job.document_version,
      mimeType: meta.mime_type,
      bytes: null,
    });
  } catch {
    await deps.markFailed({
      jobId: job.job_id,
      errorCode: "provider_failed",
      retryable: true,
      leaseClaimedAt: job.claimed_at,
    });
    return {
      job_id: job.job_id,
      outcome: "failed",
      error_code: "provider_failed",
      duration_ms: duration(),
    };
  }

  const completed = await deps.complete({
    jobId: job.job_id,
    leaseClaimedAt: job.claimed_at,
    normalized: result.normalized,
    raw: result.raw,
  });

  if (!completed.ok) {
    if (
      completed.error_code === "document_not_current" ||
      completed.status === "stale"
    ) {
      return {
        job_id: job.job_id,
        outcome: "stale",
        error_code: "document_not_current",
        duration_ms: duration(),
      };
    }
    const code = (completed.error_code ??
      "complete_conflict") as DocumentExtractionErrorCode;
    return {
      job_id: job.job_id,
      outcome: "failed",
      error_code: code,
      duration_ms: duration(),
    };
  }

  const out: WorkerProcessOutcome = {
    job_id: job.job_id,
    outcome: "done",
    duration_ms: duration(),
  };
  safeLog(deps.log, {
    job_id: job.job_id,
    extraction_id: job.extraction_id,
    documento_id: job.documento_id,
    document_type: job.document_type,
    provider: job.provider,
    status: "done",
    outcome: "done",
    duration_ms: out.duration_ms,
    attempts: job.attempts,
  });
  return out;
}
