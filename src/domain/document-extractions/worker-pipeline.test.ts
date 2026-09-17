import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  documentExtractionWorkerSecretIsValid,
  DOCUMENT_EXTRACTION_WORKER_SECRET_HEADER,
} from "./worker-auth";
import {
  isRetryableDocumentExtractionError,
  isSupportedDocumentExtractionProvider,
} from "./codes";
import { ShadowDocumentExtractionProvider } from "./provider";
import {
  processClaimedExtractionJob,
  type ClaimedExtractionJob,
  type WorkerDeps,
} from "./worker-pipeline";

function baseJob(
  over: Partial<ClaimedExtractionJob> = {},
): ClaimedExtractionJob {
  return {
    job_id: "a3d00000-0000-4000-8000-000000000001",
    extraction_id: "a3d00000-0000-4000-8000-000000000002",
    documento_id: "a3d00000-0000-4000-8000-000000000003",
    organization_id: "a3d00000-0000-4000-8000-000000000004",
    expediente_id: "a3d00000-0000-4000-8000-000000000005",
    document_type: "cliente_ine_frente",
    document_version: 1,
    provider: "shadow",
    provider_version: "p3",
    attempts: 1,
    max_attempts: 5,
    claimed_at: "2026-09-17T12:00:00.000Z",
    lease_expires_at: "2026-09-17T12:05:00.000Z",
    ...over,
  };
}

function mockDeps(over: Partial<WorkerDeps> = {}): WorkerDeps & {
  calls: string[];
  logs: Record<string, unknown>[];
} {
  const calls: string[] = [];
  const logs: Record<string, unknown>[] = [];
  return {
    calls,
    logs,
    loadMeta: async () => ({
      ok: true,
      documento_is_current: true,
      storage_bucket: "expediente-documentos",
      storage_path: "synthetic/p3/doc.pdf",
      mime_type: "application/pdf",
    }),
    complete: async () => {
      calls.push("complete");
      return { ok: true, status: "done" };
    },
    markStale: async () => {
      calls.push("stale");
      return { ok: true, status: "stale" };
    },
    markFailed: async (a) => {
      calls.push(`failed:${a.errorCode}:${a.retryable}`);
      return { ok: true, status: "failed" };
    },
    log: (f) => {
      logs.push(f);
    },
    ...over,
  };
}

describe("document-extractions P3 — auth + provider", () => {
  it("secret header propio (no Sheets)", () => {
    assert.equal(
      DOCUMENT_EXTRACTION_WORKER_SECRET_HEADER,
      "x-concasa-doc-extraction-secret",
    );
    assert.equal(documentExtractionWorkerSecretIsValid("", "x"), false);
    assert.equal(documentExtractionWorkerSecretIsValid("abc", "abc"), true);
    assert.equal(documentExtractionWorkerSecretIsValid("abc", "abd"), false);
  });

  it("solo provider shadow permitido", () => {
    assert.equal(isSupportedDocumentExtractionProvider("shadow"), true);
    assert.equal(isSupportedDocumentExtractionProvider("openai"), false);
    assert.equal(isSupportedDocumentExtractionProvider("google"), false);
  });

  it("shadow extract sin PII", async () => {
    const r = await new ShadowDocumentExtractionProvider().extract({
      documentType: "cliente_ine_frente",
      documentId: "a3d00000-0000-4000-8000-000000000003",
      documentVersion: 1,
    });
    assert.equal(r.provider, "shadow");
    assert.equal(r.providerVersion, "p3");
    assert.equal(r.raw, null);
    assert.deepEqual(r.normalized, { fields: {} });
    assert.equal(JSON.stringify(r).includes("CURP"), false);
  });
});

describe("document-extractions P3 — worker pipeline", () => {
  it("shadow job → done", async () => {
    const deps = mockDeps();
    const out = await processClaimedExtractionJob(baseJob(), deps);
    assert.equal(out.outcome, "done");
    assert.ok(deps.calls.includes("complete"));
  });

  it("stale before process", async () => {
    const deps = mockDeps({
      loadMeta: async () => ({
        ok: true,
        documento_is_current: false,
        storage_bucket: "expediente-documentos",
        storage_path: "synthetic/p3/doc.pdf",
      }),
    });
    const out = await processClaimedExtractionJob(baseJob(), deps);
    assert.equal(out.outcome, "stale");
    assert.ok(deps.calls.includes("stale"));
  });

  it("stale during complete", async () => {
    const deps = mockDeps({
      complete: async () => ({
        ok: false,
        error_code: "document_not_current",
        status: "stale",
      }),
    });
    const out = await processClaimedExtractionJob(baseJob(), deps);
    assert.equal(out.outcome, "stale");
  });

  it("unsupported provider", async () => {
    const deps = mockDeps();
    const out = await processClaimedExtractionJob(
      baseJob({ provider: "openai" }),
      deps,
    );
    assert.equal(out.outcome, "skipped_unsupported");
    assert.ok(deps.calls.some((c) => c.startsWith("failed:unsupported_provider")));
  });

  it("storage missing", async () => {
    const deps = mockDeps({
      loadMeta: async () => ({
        ok: true,
        documento_is_current: true,
        storage_bucket: "expediente-documentos",
        storage_path: "",
      }),
    });
    const out = await processClaimedExtractionJob(baseJob(), deps);
    assert.equal(out.outcome, "failed");
    assert.equal(out.error_code, "storage_missing");
  });

  it("logs sin PII / path", async () => {
    const deps = mockDeps();
    await processClaimedExtractionJob(baseJob(), deps);
    const blob = JSON.stringify(deps.logs);
    assert.equal(blob.includes("synthetic/p3"), false);
    assert.equal(blob.includes("CURP"), false);
    assert.equal(blob.includes("CLABE"), false);
    assert.ok(blob.includes("job_id"));
  });

  it("download OK → pipeline continúa; download error → mark_failed", async () => {
    const depsOk = mockDeps({
      assertStorageReadable: async () => ({ ok: true }),
    });
    const outOk = await processClaimedExtractionJob(baseJob(), depsOk);
    assert.equal(outOk.outcome, "done");

    const depsFail = mockDeps({
      assertStorageReadable: async () => ({
        ok: false,
        error_code: "storage_download_failed",
      }),
    });
    const outFail = await processClaimedExtractionJob(baseJob(), depsFail);
    assert.equal(outFail.outcome, "failed");
    assert.equal(outFail.error_code, "storage_download_failed");
    assert.ok(
      depsFail.calls.some((c) => c.startsWith("failed:storage_download_failed")),
    );
  });

  it("sanitize catalog: desconocido → internal_error conceptual", () => {
    assert.equal(
      isRetryableDocumentExtractionError("max_attempts_exceeded"),
      false,
    );
    assert.equal(isRetryableDocumentExtractionError("provider_failed"), true);
    assert.equal(isRetryableDocumentExtractionError("unsupported_provider"), false);
  });
});
