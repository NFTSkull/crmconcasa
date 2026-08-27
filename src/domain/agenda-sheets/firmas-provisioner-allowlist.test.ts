/**
 * Evidencia estática Fase 2A: provisioner solo writes allowlisted.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertProvisionerRequestsAllowed,
  buildFirmasProvisionerPlan,
  buildProvisionerBatchRequests,
  collectUpdateCellsColumnIndexes,
  computeHourDeficits,
  lastUsedRowFromGrid,
  requestsContainForbiddenToken,
} from "../../../supabase/functions/_shared/agenda-sheets/firmas-provisioner-plan.ts";

const ROOT = join(
  process.cwd(),
  "supabase/functions/agenda-sheet-firmas-provisioner",
);
const PLAN = join(
  process.cwd(),
  "supabase/functions/_shared/agenda-sheets/firmas-provisioner-plan.ts",
);
const ADAPTER = join(
  process.cwd(),
  "supabase/functions/_shared/agenda-sheets/google-firmas-provisioner.ts",
);

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkTs(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("agenda-sheet-firmas-provisioner write allowlist", () => {
  it("fuente no contiene insertDimension/deleteDimension/PASTE_NORMAL como emitibles", () => {
    const files = [...walkTs(ROOT), PLAN, ADAPTER];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // El plan puede mencionar tokens en comentarios de prohibición / tests de gate —
      // pero NO debe construir insertDimension/deleteDimension/PASTE_NORMAL como requests.
      if (file.endsWith("firmas-provisioner-plan.ts")) {
        assert.equal(src.includes('pasteType: "PASTE_NORMAL"'), false, file);
        assert.equal(src.includes("insertDimension:"), false, file);
        assert.equal(src.includes("deleteDimension:"), false, file);
        assert.match(src, /PASTE_FORMAT/);
        assert.match(src, /appendDimension/);
        continue;
      }
      assert.equal(src.includes("insertDimension"), false, `${file} insertDimension`);
      assert.equal(src.includes("deleteDimension"), false, `${file} deleteDimension`);
      assert.equal(src.includes("PASTE_NORMAL"), false, `${file} PASTE_NORMAL`);
      assert.equal(src.includes("PASTE_VALUES"), false, `${file} PASTE_VALUES`);
      // No debe llamar al adapter de escritura genérico sin allowlist
      assert.equal(src.includes("createGoogleSheetsAdapter"), false, file);
    }
  });

  it("build requests: solo col A en updateCells; sin insert/delete/PASTE_NORMAL", () => {
    const plan = buildFirmasProvisionerPlan({
      bookingDate: "2026-09-30",
      sheetId: 1641209889,
      sheetTitle: "30 SEPTIEMBRE",
      lastUsedRowPre: 53,
      gridRowCount: 999,
      mtyPhysical: { "08:00": 0, "09:00": 3, "10:00": 3 },
      apoPhysical: { "08:00": 0, "09:00": 0, "10:00": 0 },
      sources: {
        headerFormatRow: 7,
        mty08: 9,
        mty09: 12,
        mty10: 18,
        apo: 4,
      },
    });
    assert.equal(plan.decision, "SAFE_CANONICAL_APPEND");
    assert.equal(plan.monterrey["08:00"].add, 5);
    assert.equal(plan.monterrey["09:00"].add, 2);
    assert.equal(plan.apodaca["08:00"].add, 5);
    assert.equal(plan.firstNewRow, 54);
    const reqs = buildProvisionerBatchRequests(plan);
    assert.equal(requestsContainForbiddenToken(reqs, "insertDimension"), false);
    assert.equal(requestsContainForbiddenToken(reqs, "deleteDimension"), false);
    assert.equal(requestsContainForbiddenToken(reqs, "PASTE_NORMAL"), false);
    assert.equal(requestsContainForbiddenToken(reqs, "PASTE_VALUES"), false);
    assert.ok(requestsContainForbiddenToken(reqs, "PASTE_FORMAT"));
    assert.ok(requestsContainForbiddenToken(reqs, "appendDimension") === false || true);
    // appendDimension only if needed — grid 999 > lastNew → no append
    assert.equal(
      reqs.some((r) => "appendDimension" in (r as object)),
      false,
    );
    const cols = collectUpdateCellsColumnIndexes(reqs);
    assert.ok(cols.length > 0);
    assert.ok(cols.every((c) => c === 0), "solo columna A (index 0)");
    assertProvisionerRequestsAllowed(reqs, {
      sheetId: plan.sheetId,
      lastUsedRowPre: plan.lastUsedRowPre,
    });
  });

  it("reject PASTE_NORMAL / insertDimension / B:U updateCells", () => {
    const ctx = { sheetId: 1, lastUsedRowPre: 10 };
    assert.throws(() =>
      assertProvisionerRequestsAllowed(
        [{ insertDimension: { range: { sheetId: 1 } } }],
        ctx,
      ),
    );
    assert.throws(() =>
      assertProvisionerRequestsAllowed(
        [
          {
            copyPaste: {
              pasteType: "PASTE_NORMAL",
              destination: {
                sheetId: 1,
                startRowIndex: 10,
                endRowIndex: 11,
                startColumnIndex: 0,
                endColumnIndex: 21,
              },
            },
          },
        ],
        ctx,
      ),
    );
    assert.throws(() =>
      assertProvisionerRequestsAllowed(
        [
          {
            updateCells: {
              range: {
                sheetId: 1,
                startRowIndex: 10,
                endRowIndex: 11,
                startColumnIndex: 1,
                endColumnIndex: 4,
              },
              fields: "userEnteredValue",
            },
          },
        ],
        ctx,
      ),
    );
  });

  it("deficits y lastUsedRow helpers", () => {
    const d = computeHourDeficits({ "08:00": 0, "09:00": 3, "10:00": 5 });
    assert.equal(d["08:00"].add, 5);
    assert.equal(d["09:00"].add, 2);
    assert.equal(d["10:00"].add, 0);
    assert.equal(lastUsedRowFromGrid([["a"], [], ["b"], []]), 3);
  });
});
