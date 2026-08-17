/**
 * Edge Function: infonavit-pdf-worker (P189 B4)
 * Interna. Invocación manual local. Sin cron / pg_net / Vault.
 *
 * Auth: INFONAVIT_PDF_WORKER_SECRET via x-concasa-worker-secret
 * ANTES de parsear body / DB / Storage.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  INFONAVIT_PDF_WORKER_SECRET_ENV,
  INFONAVIT_PDF_WORKER_SECRET_HEADER,
  workerSecretIsValid,
} from "../_shared/infonavit-pdf/worker-auth.ts";
import {
  classifyRpcError,
  classifyWorkerError,
  generatePdfForLoadedJob,
  operationalLog,
  type ClaimedOutboxMeta,
  type LoadedJob,
} from "../_shared/infonavit-pdf/worker-pipeline.ts";
import type { InfonavitWorkerErrorCode } from "../_shared/infonavit-pdf/worker-codes.ts";
import { isRetryableWorkerCode } from "../_shared/infonavit-pdf/worker-codes.ts";
import { loadBundledTemplateBytes } from "./templates.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function claimJobs(
  sb: SupabaseClient,
  outboxId: string | null,
): Promise<ClaimedOutboxMeta[]> {
  const { data, error } = await sb.rpc("infonavit_pdf_claim_outbox", {
    p_outbox_id: outboxId,
    p_limit: outboxId ? 1 : 3,
  });
  if (error) {
    throw Object.assign(new Error(error.message), {
      code: classifyRpcError(error.message),
    });
  }
  const claimed = (data as { claimed?: ClaimedOutboxMeta[] } | null)?.claimed;
  return Array.isArray(claimed) ? claimed : [];
}

async function loadJob(
  sb: SupabaseClient,
  outboxId: string,
): Promise<LoadedJob> {
  const { data, error } = await sb.rpc("infonavit_pdf_load_claimed_job", {
    p_outbox_id: outboxId,
  });
  if (error) {
    throw Object.assign(new Error(error.message), {
      code: classifyRpcError(error.message),
    });
  }
  return data as LoadedJob;
}

async function failJob(
  sb: SupabaseClient,
  args: {
    outboxId: string;
    code: InfonavitWorkerErrorCode;
    retryable: boolean;
    leaseStartedAt: string | null;
  },
): Promise<void> {
  const { error } = await sb.rpc("infonavit_pdf_fail_outbox", {
    p_outbox_id: args.outboxId,
    p_error_code: args.code,
    p_retryable: args.retryable,
    p_lease_started_at: args.leaseStartedAt,
  });
  if (error) {
    operationalLog({
      outbox_id: args.outboxId,
      document_type: "unknown",
      submission_version: -1,
      attempt: -1,
      error_code: "DOCUMENT_REGISTER_FAILED",
    });
  }
}

async function completeJob(
  sb: SupabaseClient,
  args: {
    outboxId: string;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
  },
): Promise<void> {
  const { error } = await sb.rpc("infonavit_pdf_complete_outbox", {
    p_outbox_id: args.outboxId,
    p_storage_path: args.storagePath,
    p_mime_type: args.mimeType,
    p_size_bytes: args.sizeBytes,
  });
  if (error) {
    throw Object.assign(new Error(error.message), {
      code: "DOCUMENT_REGISTER_FAILED",
    });
  }
}

async function uploadPdf(
  sb: SupabaseClient,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const { error } = await sb.storage
    .from("expediente-documentos")
    .upload(path, copy, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (error) {
    throw Object.assign(new Error("storage upload failed"), {
      code: "STORAGE_UPLOAD_FAILED",
    });
  }
}

async function processOne(
  sb: SupabaseClient,
  meta: ClaimedOutboxMeta,
): Promise<{ ok: true } | { ok: false; outbox_id: string; code: string }> {
  const lease = meta.processing_started_at ?? null;
  try {
    const job = await loadJob(sb, meta.outbox_id);
    const templateBytes = await loadBundledTemplateBytes(job.b1_document_type);
    const pdf = await generatePdfForLoadedJob({ job, templateBytes });
    try {
      await uploadPdf(sb, pdf.storagePath, pdf.bytes);
    } catch (uploadErr) {
      const classified = classifyWorkerError(uploadErr);
      operationalLog({
        outbox_id: meta.outbox_id,
        document_type: meta.document_type,
        submission_version: meta.submission_version,
        attempt: meta.attempts,
        error_code: classified.code,
      });
      await failJob(sb, {
        outboxId: meta.outbox_id,
        code: "STORAGE_UPLOAD_FAILED",
        retryable: true,
        leaseStartedAt: lease,
      });
      return { ok: false, outbox_id: meta.outbox_id, code: "STORAGE_UPLOAD_FAILED" };
    }

    try {
      await completeJob(sb, {
        outboxId: meta.outbox_id,
        storagePath: pdf.storagePath,
        mimeType: pdf.mimeType,
        sizeBytes: pdf.sizeBytes,
      });
    } catch (completeErr) {
      const classified = classifyWorkerError(completeErr);
      operationalLog({
        outbox_id: meta.outbox_id,
        document_type: meta.document_type,
        submission_version: meta.submission_version,
        attempt: meta.attempts,
        error_code: classified.code,
      });
      await failJob(sb, {
        outboxId: meta.outbox_id,
        code: "DOCUMENT_REGISTER_FAILED",
        retryable: true,
        leaseStartedAt: lease,
      });
      return {
        ok: false,
        outbox_id: meta.outbox_id,
        code: "DOCUMENT_REGISTER_FAILED",
      };
    }

    operationalLog({
      outbox_id: meta.outbox_id,
      document_type: meta.document_type,
      submission_version: meta.submission_version,
      attempt: meta.attempts,
    });
    return { ok: true };
  } catch (err) {
    const classified = classifyWorkerError(err);
    operationalLog({
      outbox_id: meta.outbox_id,
      document_type: meta.document_type,
      submission_version: meta.submission_version,
      attempt: meta.attempts,
      error_code: classified.code,
    });
    await failJob(sb, {
      outboxId: meta.outbox_id,
      code: classified.code,
      retryable: classified.retryable && isRetryableWorkerCode(classified.code),
      leaseStartedAt: lease,
    });
    return { ok: false, outbox_id: meta.outbox_id, code: classified.code };
  }
}

const workerPort = Deno.env.get("INFONAVIT_PDF_WORKER_PORT");
const handler = async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, code: "AUTH_FAILED" });
  }

  const expected = (Deno.env.get(INFONAVIT_PDF_WORKER_SECRET_ENV) ?? "").trim();
  const provided = req.headers.get(INFONAVIT_PDF_WORKER_SECRET_HEADER) ?? "";
  if (!workerSecretIsValid(expected, provided)) {
    return jsonResponse(401, { ok: false, code: "AUTH_FAILED" });
  }

  let body: { outbox_id?: unknown } = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text) as { outbox_id?: unknown };
    } catch {
      return jsonResponse(400, { ok: false, code: "OUTBOX_NOT_FOUND" });
    }
  }

  if (
    Object.keys(body).some((k) => k !== "outbox_id") ||
    (body.outbox_id !== undefined &&
      (typeof body.outbox_id !== "string" || !UUID_RE.test(body.outbox_id)))
  ) {
    return jsonResponse(400, { ok: false, code: "OUTBOX_NOT_FOUND" });
  }

  const outboxId =
    typeof body.outbox_id === "string" ? body.outbox_id : null;

  const url = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!url || !serviceKey) {
    return jsonResponse(500, { ok: false, code: "AUTH_FAILED" });
  }

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let claimed: ClaimedOutboxMeta[];
  try {
    claimed = await claimJobs(sb, outboxId);
  } catch (err) {
    const classified = classifyWorkerError(err);
    return jsonResponse(500, { ok: false, code: classified.code });
  }

  const failures: Array<{ outbox_id: string; code: string }> = [];
  let done = 0;
  for (const meta of claimed) {
    const result = await processOne(sb, meta);
    if (result.ok) done += 1;
    else failures.push({ outbox_id: result.outbox_id, code: result.code });
  }

  return jsonResponse(200, {
    ok: failures.length === 0,
    claimed: claimed.length,
    done,
    failed: failures.length,
    failures,
  });
};

if (workerPort) {
  Deno.serve({ port: Number(workerPort) }, handler);
} else {
  Deno.serve(handler);
}
