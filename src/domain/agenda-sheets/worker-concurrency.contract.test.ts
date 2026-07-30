import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mig129 = readFileSync(
  join(process.cwd(), "supabase/migrations/129_google_sheets_agenda_sync.sql"),
  "utf8",
);
const mig130 = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/130_agenda_sheet_sync_worker_cron.sql",
  ),
  "utf8",
);
const mig132 = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/132_agenda_sheet_reconcile_cron.sql",
  ),
  "utf8",
);
const mig134 = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/134_agenda_sheet_sync_title_space_and_requeue.sql",
  ),
  "utf8",
);
const worker = readFileSync(
  join(
    process.cwd(),
    "supabase/functions/agenda-sheet-sync-worker/index.ts",
  ),
  "utf8",
);
const reconcile = readFileSync(
  join(
    process.cwd(),
    "supabase/functions/agenda-sheet-reconcile/index.ts",
  ),
  "utf8",
);

/**
 * Evidencia estática del claim atómico (FOR UPDATE SKIP LOCKED + límite).
 * La prueba SQL aislada ejercita el RPC; aquí garantizamos que el contrato
 * de concurrencia no se regressione en la migración.
 */
describe("agenda-sheet outbox concurrency contract", () => {
  it("claim usa FOR UPDATE SKIP LOCKED y acota p_limit", () => {
    assert.match(mig129, /FOR UPDATE SKIP LOCKED/);
    assert.match(mig129, /LEAST\(COALESCE\(p_limit, 10\), 50\)/);
    assert.match(mig129, /agenda_sheet_claim_outbox/);
  });

  it("worker no procesa con sync apagado (2xx no-op)", () => {
    assert.match(worker, /GOOGLE_SHEETS_SYNC_ENABLED[\s\S]*disabled:\s*true/);
    assert.match(worker, /x-concasa-worker-secret/);
    assert.match(worker, /GOOGLE_SHEETS_WORKER_SECRET/);
  });

  it("cron 130 es idempotente y no hardcodea secretos", () => {
    assert.match(mig130, /agenda-sheet-sync-worker-every-minute/);
    assert.match(mig130, /\* \* \* \* \*/);
    assert.match(mig130, /agenda_sheet_project_url/);
    assert.match(mig130, /agenda_sheet_worker_secret/);
    assert.match(mig130, /x-concasa-worker-secret/);
    assert.doesNotMatch(mig130, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(mig130, /eyJ[A-Za-z0-9_-]{10,}/);
  });
});

describe("agenda-sheet reconcile cron contract (mig. 132)", () => {
  it("cron 132 invoca reconcile cada 15m sin secretos hardcodeados", () => {
    assert.match(mig132, /agenda-sheet-reconcile-every-15m/);
    assert.match(mig132, /\*\/15 \* \* \* \*/);
    assert.match(mig132, /agenda_sheet_invoke_reconcile/);
    assert.match(mig132, /functions\/v1\/agenda-sheet-reconcile/);
    assert.match(mig132, /agenda_sheet_project_url/);
    assert.match(mig132, /agenda_sheet_worker_secret/);
    assert.doesNotMatch(mig132, /BEGIN PRIVATE KEY/);
  });

  it("reconcile procesa firmas/bio y conserva título crudo de pestaña", () => {
    assert.match(reconcile, /2026-07-30/);
    assert.match(reconcile, /buildInventoryUpsertRows/);
    assert.match(reconcile, /agenda_sheet_inventory_upsert_batch/);
    assert.match(reconcile, /titleRaw/);
    assert.match(reconcile, /No trim del título/);
  });
});

describe("agenda-sheet sync title space + requeue (mig. 134)", () => {
  it("upsert_batch no hace btrim de sheet_title", () => {
    assert.match(mig134, /no btrim/);
    assert.match(
      mig134,
      /v_sheet_title := COALESCE\(v_elem->>'sheet_title', ''\)/,
    );
    assert.doesNotMatch(
      mig134,
      /v_sheet_title := NULLIF\(btrim\(COALESCE\(v_elem->>'sheet_title'/,
    );
  });

  it("claim recupera processing abandonado y requeue dead existe", () => {
    assert.match(mig134, /processing_timeout/);
    assert.match(mig134, /INTERVAL '10 minutes'/);
    assert.match(mig134, /agenda_sheet_requeue_dead_sync/);
    assert.match(
      mig134,
      /GRANT EXECUTE ON FUNCTION public\.agenda_sheet_requeue_dead_sync/,
    );
    assert.match(mig134, /TO service_role, postgres/);
  });

  it("worker resuelve título live y verifica escritura antes de done", () => {
    assert.match(worker, /resolveLiveTitle/);
    assert.match(worker, /write_verify_failed/);
    assert.match(worker, /listSheets\(\)/);
    assert.match(worker, /booking_cancelled/);
    assert.match(worker, /agenda_sheet_slot_inventory/);
  });

  it("cron worker (130) y reconcile (132) siguen separados", () => {
    assert.match(mig130, /agenda-sheet-sync-worker-every-minute/);
    assert.match(mig132, /agenda-sheet-reconcile-every-15m/);
    assert.doesNotMatch(mig134, /agenda-sheet-reconcile-every-15m/);
    assert.doesNotMatch(mig134, /cron\.schedule/);
  });
});
