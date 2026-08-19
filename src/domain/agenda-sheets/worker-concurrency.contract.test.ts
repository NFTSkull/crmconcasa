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

  it("worker limpia B:D/O:U con batchClear y marca dead en manual_result_conflict", () => {
    assert.match(worker, /classifyCancelRowClearance/);
    assert.match(worker, /cancelClearBatchRanges/);
    assert.match(worker, /batchClear/);
    assert.match(worker, /booking_cancelled_cleanup/);
    assert.match(worker, /manual_result_conflict/);
    assert.match(worker, /p_status:\s*"dead"/);
    assert.match(worker, /agenda_sheet_mark_cancelled_cleared/);
    assert.match(worker, /duplicate_booking_row/);
    assert.match(worker, /dry_run_cancel_cleanup/);
    assert.doesNotMatch(worker, /buildClearedVisibleAdRow/);
    assert.doesNotMatch(
      worker,
      /estado:\s*"CANCELADA"/,
    );
  });

  it("hotfix reagendar: orden cancel→create, coords, gate prior, restore", () => {
    assert.match(worker, /sortOutboxForRescheduleMove/);
    assert.match(worker, /resolveCancelSheetCoords/);
    assert.match(worker, /decidePriorCancelGate/);
    assert.match(worker, /missing_sheet_coords_for_cancel/);
    assert.match(worker, /prior_cancelled_booking_id/);
    assert.match(worker, /p_error:\s*gate\.reason/);
    assert.match(worker, /restorePriorSheetRow/);
    assert.match(worker, /clearedByBooking/);
  });

  it("reagendado histórico: REAGENDADO + replacement + reindex (no clear PII)", () => {
    assert.match(worker, /isRescheduleCancelContext/);
    assert.match(worker, /inspectRescheduleHistoryState/);
    assert.match(worker, /buildRescheduledHistoryTechRow/);
    assert.match(worker, /buildInsertRowBelowRequests/);
    assert.match(worker, /buildOrangeHistoryFormatRequests/);
    assert.match(worker, /historyByBooking/);
    assert.match(worker, /isPriorSheetStillActivelyOwned/);
    assert.match(worker, /batchUpdateSpreadsheet/);
    assert.match(worker, /locateSheetRowByBookingId/);
    assert.match(worker, /sortRescheduleJobsForTabSafety/);
    assert.match(worker, /decideHistoryRollbackFromGrid/);
    assert.match(worker, /a1FullTabAuRange/);
    const cancelStart = worker.indexOf("// Cancelación / cleanup");
    const cancelEnd = worker.indexOf("// booking_created desde CRM");
    assert.ok(cancelStart > 0 && cancelEnd > cancelStart);
    const cancelBlock = worker.slice(cancelStart, cancelEnd);
    assert.match(cancelBlock, /rescheduleCtx/);
    assert.match(cancelBlock, /REAGENDADO|buildRescheduledHistoryTechRow/);
    // Cancelación pura sigue con batchClear; reagendo usa batchUpdateValues.
    assert.match(cancelBlock, /batchClear/);
    assert.match(cancelBlock, /shouldYieldCancelClearToRescheduleHistory/);
    const yieldIdx = cancelBlock.indexOf("shouldYieldCancelClearToRescheduleHistory");
    const conflictDeadIdx = cancelBlock.indexOf(
      "manual_result_conflict:sheetId=",
    );
    assert.ok(yieldIdx > 0, "helper yield presente en cancel");
    assert.ok(
      conflictDeadIdx > yieldIdx,
      "C4: E/F conflict no marca dead antes de evaluar reagenda",
    );
  });

  it("dry_run_cancel_cleanup exige secreto worker antes del body", () => {
    const authIdx = worker.indexOf('jsonError(401, "unauthorized"');
    const dryIdx = worker.indexOf("dry_run_cancel_cleanup");
    assert.ok(authIdx > 0, "auth gate presente");
    assert.ok(dryIdx > authIdx, "dry-run solo tras auth");
    assert.match(worker, /x-concasa-worker-secret/);
    assert.match(worker, /GOOGLE_SHEETS_WORKER_SECRET/);
    // Cancel handler: batchClear ranges B:D + O:U en rama pura; reagendo escribe O.
    const cancelStart = worker.indexOf("// Cancelación / cleanup");
    const cancelEnd = worker.indexOf("// booking_created desde CRM");
    assert.ok(cancelStart > 0 && cancelEnd > cancelStart);
    const cancelBlock = worker.slice(cancelStart, cancelEnd);
    assert.match(cancelBlock, /batchClear/);
    assert.doesNotMatch(cancelBlock, /a1VisibleRange/);
  });

  it("booking_created escribe solo B:D + O:U (A read-only)", () => {
    const start = worker.indexOf("// booking_created desde CRM");
    assert.ok(start > 0, "bloque booking_created");
    const end = worker.indexOf("// booking_created ya tiene link", start);
    assert.ok(end > start, "fin bloque booking_created");
    const block = worker.slice(start, end);
    assert.match(block, /batchUpdateValues/);
    assert.match(block, /a1BdRange/);
    assert.match(block, /a1TechRange/);
    assert.match(block, /buildPhysicalSheetRowKey/);
    assert.doesNotMatch(block, /a1VisibleRange/);
    assert.doesNotMatch(block, /A\$\{|!A\d+:D/);
    assert.doesNotMatch(block, /horaKeep/);
    assert.match(block, /decideCreateRowOccupancy/);
    assert.match(block, /write_verify_failed:col_a_mutated/);
  });

  it("C9/C10: tab missing/ambiguous marca failed, no done", () => {
    const start = worker.indexOf("// booking_created desde CRM");
    const end = worker.indexOf("// booking_created ya tiene link", start);
    const block = worker.slice(start, end);
    assert.match(block, /missing_sheet_for_date/);
    assert.match(block, /ambiguous_sheet_for_date/);
    const missingIdx = block.indexOf("missing_sheet_for_date");
    const slice = block.slice(missingIdx, missingIdx + 520);
    assert.match(slice, /p_status:\s*"failed"/);
    assert.doesNotMatch(slice, /p_status:\s*"done"/);
  });

  it("P174 cancel nunca escribe A (solo B:D + O:U clear)", () => {
    const cancelStart = worker.indexOf("// Cancelación / cleanup");
    const cancelEnd = worker.indexOf("// booking_created desde CRM");
    const cancelBlock = worker.slice(cancelStart, cancelEnd);
    assert.match(cancelBlock, /batchClear/);
    assert.match(cancelBlock, /cancelClearBatchRanges/);
    // Clear puro no usa a1VisibleRange / rewrite A:D
    assert.doesNotMatch(cancelBlock, /a1VisibleRange/);
    assert.doesNotMatch(cancelBlock, /buildClearedVisibleAdRow/);
    // P121 replacement (única escritura A) usa inspection.hora exacta
    const repl = cancelBlock.indexOf("// Replacement: misma hora");
    assert.ok(repl > 0, "replacement P121 en cancel+reagendo");
    const replBlock = cancelBlock.slice(repl, repl + 800);
    assert.match(replBlock, /inspection\.hora/);
    assert.doesNotMatch(replBlock, /booking_time/);
    assert.doesNotMatch(replBlock, /resolveLogicalStartTime/);
  });

  it("booking_created usa fila preasignada (inventory claimed / payload.sheet_row)", () => {
    const start = worker.indexOf("// booking_created desde CRM");
    const end = worker.indexOf("// booking_created ya tiene link", start);
    const block = worker.slice(start, end);
    // Prefiere coords del payload (claim) y, si faltan, inventory claimed|linked.
    assert.match(block, /payload\.sheet_row/);
    assert.match(block, /payload\.inventory_id/);
    assert.match(block, /\.in\("status",\s*\["claimed",\s*"linked"\]\)/);
    assert.match(block, /no_preassigned_sheet_row/);
    assert.match(block, /agenda_sheet_upsert_link_from_crm/);
    assert.match(block, /agenda_sheet_inventory_mark_linked/);
    assert.match(block, /agenda_sheet_mark_outbox/);
    assert.match(block, /p_status:\s*"done"/);
    // No abre búsqueda libre de cupo en create CRM.
    assert.doesNotMatch(block, /status\",\s*\"available\"/);
  });

  it("claim limit del worker permanece acotado (backlog multi-pass)", () => {
    assert.match(worker, /agenda_sheet_claim_outbox[\s\S]*p_limit:\s*10/);
    assert.match(mig129, /LEAST\(COALESCE\(p_limit, 10\), 50\)/);
    // 20 pending / limit 10 ⇒ ≥2 ejecuciones; no inflar limit por incidente.
    const limit = 10;
    const pending = 20;
    assert.equal(Math.ceil(pending / limit), 2);
  });

  it("P175: worker trata kind de forma genérica (incluye inscripcion)", () => {
    // booking_created lee payload.kind sin whitelist bio|firmas.
    const start = worker.indexOf("// booking_created desde CRM");
    const end = worker.indexOf("// booking_created ya tiene link", start);
    assert.ok(start > 0 && end > start);
    const block = worker.slice(start, end);
    assert.match(block, /payload\.kind/);
    assert.doesNotMatch(
      block,
      /kind\s*(===|==)\s*["']biometricos["'][\s\S]{0,40}firmas/,
    );
    // Outbox claim no filtra por kind — cualquier booking_kind (p.ej. inscripcion) entra.
    assert.match(worker, /agenda_sheet_claim_outbox/);
    assert.doesNotMatch(worker, /kind\s+IN\s*\(\s*'biometricos'/i);
  });

  it("P175: create/cancel A read-only también aplica a kind inscripcion", () => {
    // Mismos invariantes P174: create/cancel no escriben columna A (kind-agnóstico).
    const createStart = worker.indexOf("// booking_created desde CRM");
    const createEnd = worker.indexOf("// booking_created ya tiene link", createStart);
    const createBlock = worker.slice(createStart, createEnd);
    assert.doesNotMatch(createBlock, /a1VisibleRange/);
    assert.match(createBlock, /write_verify_failed:col_a_mutated/);

    const cancelStart = worker.indexOf("// Cancelación / cleanup");
    const cancelEnd = worker.indexOf("// booking_created desde CRM");
    const cancelBlock = worker.slice(cancelStart, cancelEnd);
    assert.match(cancelBlock, /batchClear/);
    assert.doesNotMatch(cancelBlock, /a1VisibleRange/);
  });
});

describe("agenda-sheet edge rescheduled-history boot contract", () => {
  const edgeHistory = readFileSync(
    join(
      process.cwd(),
      "supabase/functions/_shared/agenda-sheets/rescheduled-history.ts",
    ),
    "utf8",
  );
  const edgeTech = readFileSync(
    join(
      process.cwd(),
      "supabase/functions/_shared/agenda-sheets/tech-columns.ts",
    ),
    "utf8",
  );

  it("no importa AGENDA_SHEET_COL_INDEX inexistente desde Edge tech-columns", () => {
    assert.match(edgeTech, /export const COL_INDEX\s*=/);
    assert.doesNotMatch(edgeTech, /export const AGENDA_SHEET_COL_INDEX/);
    // Alias explícito: Domain usa AGENDA_SHEET_COL_INDEX; Edge exporta COL_INDEX.
    assert.match(
      edgeHistory,
      /COL_INDEX as AGENDA_SHEET_COL_INDEX/,
    );
    assert.doesNotMatch(
      edgeHistory,
      /import \{\s*AGENDA_SHEET_COL_INDEX\s*,/,
    );
  });
});

describe("agenda-sheet inventory upsert detach (mig. 141)", () => {
  const mig141 = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/141_agenda_sheet_inventory_upsert_restore_booking_detach.sql",
    ),
    "utf8",
  );

  it("restaura detach booking_id y conserva sheet_slot_time + índice", () => {
    assert.match(mig141, /WHERE i\.booking_id = v_booking_id/);
    assert.match(mig141, /sheet_slot_time/);
    assert.match(mig141, /no btrim/);
    assert.match(mig141, /aparece en % filas físicas del mismo batch/);
    assert.match(
      mig141,
      /GRANT EXECUTE ON FUNCTION public\.agenda_sheet_inventory_upsert_batch/,
    );
    assert.match(mig141, /TO service_role, postgres/);
    assert.doesNotMatch(mig141, /DROP INDEX.*booking_uidx/);
    assert.doesNotMatch(mig141, /UPDATE public\.agenda_bookings/);
  });
});
