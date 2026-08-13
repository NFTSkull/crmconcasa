import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { decideOpsMarkStale } from "./operational-stale-guard";

describe("P180 B1.1 decideOpsMarkStale fail-closed", () => {
  const okBase = {
    fullTabReconcile: true,
    valuesFetchOk: true,
    colorsFetchOk: true,
    gridsAligned: true,
    opsUpsertFailed: false,
    gridRowCount: 200,
    seenRows: [7, 24, 25],
  };

  it("permite stale en full reconcile válido con scope", () => {
    const d = decideOpsMarkStale(okBase);
    assert.equal(d.allow, true);
    if (d.allow) {
      assert.equal(d.rowMin, 1);
      assert.equal(d.rowMax, 200);
      assert.deepEqual(d.seenRows, [7, 24, 25]);
      assert.equal(d.allowEmptySnapshot, false);
    }
  });

  it("NUNCA desde partial/webhook (not full reconcile)", () => {
    const d = decideOpsMarkStale({ ...okBase, fullTabReconcile: false });
    assert.equal(d.allow, false);
    if (!d.allow) assert.equal(d.reason, "not_full_reconcile");
  });

  it("SKIP si falla A:U", () => {
    const d = decideOpsMarkStale({ ...okBase, valuesFetchOk: false });
    assert.equal(d.allow, false);
    if (!d.allow) assert.equal(d.reason, "values_fetch_failed");
  });

  it("SKIP si falla E:I effectiveFormat (color)", () => {
    const d = decideOpsMarkStale({ ...okBase, colorsFetchOk: false });
    assert.equal(d.allow, false);
    if (!d.allow) assert.equal(d.reason, "colors_fetch_failed");
  });

  it("SKIP si grids desalineados", () => {
    const d = decideOpsMarkStale({ ...okBase, gridsAligned: false });
    assert.equal(d.allow, false);
    if (!d.allow) assert.equal(d.reason, "grids_misaligned");
  });

  it("SKIP si upsert batch falló", () => {
    const d = decideOpsMarkStale({ ...okBase, opsUpsertFailed: true });
    assert.equal(d.allow, false);
    if (!d.allow) assert.equal(d.reason, "ops_upsert_failed");
  });

  it("empty seenRows → allowEmptySnapshot true solo con layout OK", () => {
    const d = decideOpsMarkStale({ ...okBase, seenRows: [] });
    assert.equal(d.allow, true);
    if (d.allow) assert.equal(d.allowEmptySnapshot, true);
  });

  it("grid vacío → no mass-stale", () => {
    const d = decideOpsMarkStale({ ...okBase, gridRowCount: 0, seenRows: [] });
    assert.equal(d.allow, false);
    if (!d.allow) assert.equal(d.reason, "empty_grid_scope");
  });

  it("filtra seenRows fuera de scope", () => {
    const d = decideOpsMarkStale({
      ...okBase,
      gridRowCount: 50,
      seenRows: [1, 50, 51, 200],
    });
    assert.equal(d.allow, true);
    if (d.allow) assert.deepEqual(d.seenRows, [1, 50]);
  });
});

describe("P180 B1.1 stale caller surface", () => {
  it("mark_stale solo en reconcile; webhook no lo invoca", () => {
    const reconcile = readFileSync(
      "supabase/functions/agenda-sheet-reconcile/index.ts",
      "utf8",
    );
    const webhook = readFileSync(
      "supabase/functions/agenda-sheet-webhook/index.ts",
      "utf8",
    );
    assert.match(reconcile, /decideOpsMarkStale/);
    assert.match(reconcile, /agenda_sheet_ops_mark_stale_except/);
    assert.doesNotMatch(webhook, /agenda_sheet_ops_mark_stale_except/);
    assert.doesNotMatch(webhook, /decideOpsMarkStale/);
  });
});
