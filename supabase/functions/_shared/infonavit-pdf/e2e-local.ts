/**
 * P189 B4 E2E LOCAL: claim → generate → Storage-api → complete.
 * Fixtures ficticias. 0 Cloud. 0 Kong required.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { generatePdfForLoadedJob } from "./worker-pipeline.ts";
import { INFONAVIT_B1_TEMPLATE_FILE } from "./document-type-map.ts";
import type { LoadedJob } from "./worker-pipeline.ts";
import { generateInfonavitPdfAudited } from "./generate-infonavit-pdf.ts";
import { adaptB3SnapshotToB1 } from "./snapshot-adapter.ts";
import {
  BAJO_FIELD,
  PRESUPUESTO_FIELD,
  SOLICITUD_FIELD,
} from "./template-contract.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "..", "infonavit-templates", "v1");

const DB_HOST = process.env.SUPABASE_DB_HOST ?? "127.0.0.1";
const DB_PORT = process.env.SUPABASE_DB_PORT ?? "54322";
const DB_USER = process.env.SUPABASE_DB_USER ?? "postgres";
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD ?? "postgres";
const DB_NAME = process.env.SUPABASE_DB_NAME ?? "postgres";
const STORAGE_URL = process.env.P189_STORAGE_URL ?? "http://127.0.0.1:5000";
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function psql(sql: string): string {
  return execFileSync(
    "psql",
    [
      "-v",
      "ON_ERROR_STOP=1",
      "-h",
      DB_HOST,
      "-p",
      DB_PORT,
      "-U",
      DB_USER,
      "-d",
      DB_NAME,
      "-t",
      "-A",
      "-c",
      sql,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: DB_PASSWORD },
    },
  ).trim();
}

function loadTemplate(b1File: string): Uint8Array {
  return new Uint8Array(readFileSync(join(TEMPLATES, b1File)));
}

function claimAndLoad(outboxId: string): LoadedJob {
  const claimed = JSON.parse(
    psql(`SELECT public.infonavit_pdf_claim_outbox('${outboxId}'::uuid, 1)::text;`),
  ) as { claimed: unknown[] };
  assert.equal(claimed.claimed.length, 1, "claim 1");
  return JSON.parse(
    psql(`SELECT public.infonavit_pdf_load_claimed_job('${outboxId}'::uuid)::text;`),
  ) as LoadedJob;
}

async function uploadPdf(path: string, bytes: Uint8Array): Promise<void> {
  const res = await fetch(
    `${STORAGE_URL}/object/expediente-documentos/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE,
        "Content-Type": "application/pdf",
        "x-upsert": "true",
      },
      body: bytes,
    },
  );
  if (!res.ok) {
    throw new Error(`STORAGE_UPLOAD_FAILED ${res.status}`);
  }
}

async function downloadPdf(path: string): Promise<Uint8Array> {
  const res = await fetch(
    `${STORAGE_URL}/object/authenticated/expediente-documentos/${path}`,
    {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`STORAGE_DOWNLOAD_FAILED ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function processOutbox(outboxId: string): Promise<void> {
  const job = claimAndLoad(outboxId);
  const file = INFONAVIT_B1_TEMPLATE_FILE[job.b1_document_type];
  const pdf = await generatePdfForLoadedJob({
    job,
    templateBytes: loadTemplate(file),
  });
  await uploadPdf(pdf.storagePath, pdf.bytes);
  const done = JSON.parse(
    psql(`
      SELECT public.infonavit_pdf_complete_outbox(
        '${outboxId}'::uuid,
        ${psqlLiteral(pdf.storagePath)},
        'application/pdf',
        ${pdf.sizeBytes}
      )::text;
    `),
  ) as { ok?: boolean };
  assert.equal(done.ok, true, "complete ok");
}

function psqlLiteral(s: string): string {
  return "'" + s.replaceAll("'", "''") + "'";
}

async function main(): Promise<void> {
  const boot = JSON.parse(psql("SELECT public.__p189_b4_e2e_bootstrap()::text;"));
  const expId = boot.expediente_id as string;
  const orgId = boot.organization_id as string;
  const outboxIds = boot.outbox_ids as string[];
  assert.equal(outboxIds.length, 3, "3 outbox pending");

  for (const id of outboxIds) {
    await processOutbox(id);
  }

  const rows = JSON.parse(
    psql(`
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id,
        'document_type', o.document_type,
        'status', o.status,
        'documento_id', o.documento_id,
        'storage_path', d.storage_path,
        'deleted_at', d.deleted_at,
        'version', d.version
      ) ORDER BY o.document_type)
      FROM public.infonavit_pdf_outbox o
      JOIN public.expediente_documentos d ON d.id = o.documento_id
      WHERE o.expediente_id = '${expId}' AND o.submission_version = 0;
    `),
  ) as Array<{
    document_type: string;
    status: string;
    documento_id: string;
    storage_path: string;
    deleted_at: string | null;
    version: number;
  }>;

  assert.equal(rows.length, 3, "3 docs S1");
  for (const row of rows) {
    assert.equal(row.status, "done");
    assert.ok(row.documento_id);
    assert.equal(row.deleted_at, null);
    assert.equal(row.version, 1);
    const bytes = await downloadPdf(row.storage_path);
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getForm().getFields().length, 0);
    assert.ok(doc.getPageCount() >= 1);
    assert.ok(bytes.byteLength > 0);
    assert.ok(bytes.byteLength <= 15 * 1024 * 1024);
  }

  const cartaJob = JSON.parse(
    psql(`
      SELECT row_to_json(x)::text FROM (
        SELECT o.id, s.payload
        FROM public.infonavit_pdf_outbox o
        JOIN public.expediente_infonavit_submission_snapshots s ON s.id = o.snapshot_id
        WHERE o.expediente_id = '${expId}'
          AND o.document_type = 'infonavit_carta_bajo_protesta'
          AND o.submission_version = 0
      ) x;
    `),
  ) as { payload: unknown };
  const snapshot = adaptB3SnapshotToB1(cartaJob.payload);
  const auditedCarta = await generateInfonavitPdfAudited({
    documentType: "carta_bajo_protesta",
    templateBytes: loadTemplate("carta-bajo-protesta.pdf"),
    snapshot,
  });
  assert.equal(
    auditedCarta.fieldsBeforeFlatten[BAJO_FIELD.T8_NOMBRE],
    "Lopez Perez Ana",
  );
  assert.equal(auditedCarta.fieldsBeforeFlatten[BAJO_FIELD.T9_NSS], "18500000090");

  const auditedSol = await generateInfonavitPdfAudited({
    documentType: "solicitud_inscripcion_credito",
    templateBytes: loadTemplate("solicitud-inscripcion-credito.pdf"),
    snapshot,
  });
  assert.equal(auditedSol.fieldsBeforeFlatten[SOLICITUD_FIELD.T29_PLAZO], "5");
  assert.equal(
    auditedSol.fieldsBeforeFlatten[SOLICITUD_FIELD.T55_CREDITO_INFONAVIT_BLANK],
    "",
  );
  const auditedPres = await generateInfonavitPdfAudited({
    documentType: "presupuesto_mejoramiento",
    templateBytes: loadTemplate("presupuesto-mejoramiento.pdf"),
    snapshot,
  });
  assert.match(String(auditedPres.fieldsBeforeFlatten[PRESUPUESTO_FIELD.T9_MONTO]), /25/);

  psql(`SELECT public.__p189_b4_e2e_reingreso('${expId}')::text;`);

  const s1StillActive = Number(
    psql(`
      SELECT count(*) FROM public.expediente_documentos
      WHERE expediente_id = '${expId}'
        AND tipo_documento LIKE 'infonavit_%'
        AND deleted_at IS NULL;
    `),
  );
  assert.equal(s1StillActive, 3, "S1 activo antes de procesar S2");

  const s2Ids = JSON.parse(
    psql(`
      SELECT coalesce(jsonb_agg(id ORDER BY document_type), '[]'::jsonb)::text
      FROM public.infonavit_pdf_outbox
      WHERE expediente_id = '${expId}' AND submission_version = 1;
    `),
  ) as string[];
  assert.equal(s2Ids.length, 3, "3 outbox S2");
  for (const id of s2Ids) {
    await processOutbox(id);
  }

  const s2Active = Number(
    psql(`
      SELECT count(*) FROM public.expediente_documentos d
      JOIN public.infonavit_pdf_outbox o ON o.documento_id = d.id
      WHERE d.expediente_id = '${expId}'
        AND d.tipo_documento LIKE 'infonavit_%'
        AND d.deleted_at IS NULL
        AND o.submission_version = 1;
    `),
  );
  assert.equal(s2Active, 3, "S2 activo");
  const s1Deleted = Number(
    psql(`
      SELECT count(*) FROM public.expediente_documentos d
      JOIN public.infonavit_pdf_outbox o ON o.documento_id = d.id
      WHERE d.expediente_id = '${expId}'
        AND d.tipo_documento LIKE 'infonavit_%'
        AND d.deleted_at IS NOT NULL
        AND o.submission_version = 0;
    `),
  );
  assert.equal(s1Deleted, 3, "S1 soft-deleted");

  const storageCount = Number(
    psql(`
      SELECT count(*) FROM storage.objects
      WHERE bucket_id = 'expediente-documentos'
        AND name LIKE '${orgId}/${expId}/infonavit_%';
    `),
  );
  assert.equal(storageCount, 6, "6 objetos (S1+S2) permanecen");

  console.log("P189 B4 E2E LOCAL: PASSED");
}

main().catch((err) => {
  console.error("P189 B4 E2E FAIL");
  process.exitCode = 1;
  throw err;
});
