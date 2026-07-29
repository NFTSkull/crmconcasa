import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Evidencia estática del claim atómico (FOR UPDATE SKIP LOCKED + límite).
 * La prueba SQL aislada ejercita el RPC; aquí garantizamos que el contrato
 * de concurrencia no se regressione en la migración.
 */
describe("agenda-sheet outbox concurrency contract", () => {
  const mig129 = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/129_google_sheets_agenda_sync.sql",
    ),
    "utf8",
  );
  const mig130 = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/130_agenda_sheet_sync_worker_cron.sql",
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
