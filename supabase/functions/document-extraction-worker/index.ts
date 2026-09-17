/**
 * Edge Function: document-extraction-worker (P3 shadow)
 * Auth: DOCUMENT_EXTRACTION_WORKER_SECRET via x-concasa-doc-extraction-secret
 * SIN OCR. SIN provider externo. SIN autofill. SIN cron Production.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENT_EXTRACTION_WORKER_SECRET_ENV,
  DOCUMENT_EXTRACTION_WORKER_SECRET_HEADER,
  documentExtractionWorkerSecretIsValid,
} from "../_shared/document-extractions/worker-auth.ts";
import {
  processClaimedExtractionJob,
  type ClaimedExtractionJob,
  type JobMeta,
} from "../_shared/document-extractions/worker-pipeline.ts";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function operationalLog(
  fields: Record<string, string | number | boolean | null>,
): void {
  console.log(
    JSON.stringify({ scope: "document-extraction-worker", ...fields }),
  );
}

async function claimJobs(
  sb: SupabaseClient,
  limit: number,
): Promise<ClaimedExtractionJob[]> {
  const { data, error } = await sb.rpc("document_extraction_claim_jobs", {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const claimed = (
    data as { claimed?: ClaimedExtractionJob[]; reason?: string } | null
  )?.claimed;
  return Array.isArray(claimed) ? claimed : [];
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error_code: "invalid_args" });
  }

  const expected = (Deno.env.get(DOCUMENT_EXTRACTION_WORKER_SECRET_ENV) ?? "")
    .trim();
  const provided =
    req.headers.get(DOCUMENT_EXTRACTION_WORKER_SECRET_HEADER) ?? "";
  if (!documentExtractionWorkerSecretIsValid(expected, provided)) {
    return jsonResponse(401, { ok: false, error_code: "auth_failed" });
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(500, { ok: false, error_code: "internal_error" });
  }

  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let claimed: ClaimedExtractionJob[] = [];
  try {
    claimed = await claimJobs(sb, 3);
  } catch {
    return jsonResponse(500, {
      ok: false,
      error_code: "internal_error",
      processed: 0,
    });
  }

  if (claimed.length === 0) {
    return jsonResponse(200, { ok: true, processed: 0, results: [] });
  }

  const results = [];
  for (const job of claimed) {
    const outcome = await processClaimedExtractionJob(job, {
      log: operationalLog,
      loadMeta: async (jobId) => {
        const { data, error } = await sb.rpc(
          "document_extraction_load_job_meta",
          { p_job_id: jobId },
        );
        if (error) return { ok: false, error_code: "internal_error" };
        return data as JobMeta;
      },
      assertStorageReadable: async (meta) => {
        if (!meta.storage_path || !meta.storage_bucket) {
          return { ok: false, error_code: "storage_missing" };
        }
        return { ok: true };
      },
      complete: async ({ jobId, leaseClaimedAt, normalized, raw }) => {
        const { data, error } = await sb.rpc(
          "document_extraction_complete_job",
          {
            p_job_id: jobId,
            p_payload_normalized: normalized,
            p_payload_raw: raw,
            p_lease_claimed_at: leaseClaimedAt,
          },
        );
        if (error) return { ok: false, error_code: "internal_error" };
        return data as { ok: boolean; error_code?: string; status?: string };
      },
      markStale: async (jobId, reason) => {
        const { data, error } = await sb.rpc("document_extraction_mark_stale", {
          p_job_id: jobId,
          p_reason: reason,
        });
        if (error) return { ok: false };
        return data as { ok: boolean; status?: string };
      },
      markFailed: async ({
        jobId,
        errorCode,
        retryable,
        leaseClaimedAt,
      }) => {
        const { data, error } = await sb.rpc(
          "document_extraction_mark_failed",
          {
            p_job_id: jobId,
            p_error_code: errorCode,
            p_retryable: retryable,
            p_lease_claimed_at: leaseClaimedAt,
          },
        );
        if (error) return { ok: false };
        return data as { ok: boolean; status?: string };
      },
    });
    results.push(outcome);
  }

  return jsonResponse(200, {
    ok: true,
    processed: results.length,
    results,
  });
});
