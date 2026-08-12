import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  evaluateOperationalApplyGate,
  getOperationalApplyConfig,
  parseOperationalApplyFromDate,
} from "./operational-apply-guard";

describe("operational-apply-guard B2.5", () => {
  it("1. env ausente → disabled", () => {
    const c = getOperationalApplyConfig({});
    assert.equal(c.enabled, false);
    assert.equal(c.fromDate, null);
    assert.equal(
      evaluateOperationalApplyGate({
        config: c,
        bookingDate: "2026-08-13",
      }).outcome,
      "DISABLED",
    );
  });

  it("2. env false → disabled", () => {
    const c = getOperationalApplyConfig({
      GOOGLE_SHEETS_OPERATIONAL_APPLY_ENABLED: "false",
      GOOGLE_SHEETS_OPERATIONAL_APPLY_FROM_DATE: "2026-08-13",
    });
    assert.equal(c.enabled, false);
    assert.equal(
      evaluateOperationalApplyGate({
        config: c,
        bookingDate: "2026-08-20",
      }).allow,
      false,
    );
  });

  it("3. true + no fromDate → fail closed", () => {
    const c = getOperationalApplyConfig({
      GOOGLE_SHEETS_OPERATIONAL_APPLY_ENABLED: "true",
    });
    assert.equal(c.enabled, true);
    assert.equal(c.fromDate, null);
    const g = evaluateOperationalApplyGate({
      config: c,
      bookingDate: "2026-08-13",
    });
    assert.equal(g.allow, false);
    assert.equal(g.outcome, "DISABLED_NO_CUTOVER");
  });

  it("4. true + fecha inválida → fail closed", () => {
    assert.equal(parseOperationalApplyFromDate("13-08-2026"), null);
    assert.equal(parseOperationalApplyFromDate("2026-02-30"), null);
    const c = getOperationalApplyConfig({
      GOOGLE_SHEETS_OPERATIONAL_APPLY_ENABLED: "TRUE",
      GOOGLE_SHEETS_OPERATIONAL_APPLY_FROM_DATE: "2026-13-01",
    });
    assert.equal(c.fromDate, null);
    assert.equal(
      evaluateOperationalApplyGate({
        config: c,
        bookingDate: "2026-08-13",
      }).outcome,
      "DISABLED_NO_CUTOVER",
    );
  });

  it("5–7. cutover booking_date", () => {
    const c = getOperationalApplyConfig({
      GOOGLE_SHEETS_OPERATIONAL_APPLY_ENABLED: "true",
      GOOGLE_SHEETS_OPERATIONAL_APPLY_FROM_DATE: "2026-08-13",
    });
    assert.equal(c.fromDate, "2026-08-13");
    assert.equal(
      evaluateOperationalApplyGate({
        config: c,
        bookingDate: "2026-08-12",
      }).outcome,
      "BEFORE_CUTOVER",
    );
    assert.equal(
      evaluateOperationalApplyGate({
        config: c,
        bookingDate: "2026-08-13",
      }).allow,
      true,
    );
    assert.equal(
      evaluateOperationalApplyGate({
        config: c,
        bookingDate: "2026-08-14",
      }).outcome,
      "ALLOWED",
    );
  });
});

describe("P170 B2.5 edge contract — webhook + reconcile guards", () => {
  const webhook = readFileSync(
    new URL(
      "../../../supabase/functions/agenda-sheet-webhook/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const reconcile = readFileSync(
    new URL(
      "../../../supabase/functions/agenda-sheet-reconcile/index.ts",
      import.meta.url,
    ),
    "utf8",
  );

  it("8–10. webhook: projection antes de gate; apply solo si allow", () => {
    assert.match(webhook, /agenda_sheet_ops_upsert_batch/);
    assert.match(webhook, /evaluateOperationalApplyGate/);
    assert.match(webhook, /getOperationalApplyConfig/);
    const fn = webhook.slice(webhook.indexOf("upsertAndApplyOperationalResultRow"));
    const upsertIdx = fn.indexOf("agenda_sheet_ops_upsert_batch");
    const gateIdx = fn.indexOf("evaluateOperationalApplyGate({");
    const applyIdx = fn.indexOf("await applyOperationalResult(supabase, ops)");
    assert.ok(upsertIdx >= 0 && gateIdx > upsertIdx && applyIdx > gateIdx);
    assert.match(webhook, /operational_apply_disabled|DISABLED/);
    assert.match(webhook, /BEFORE_CUTOVER|operational_apply_before_cutover/);
  });

  it("11–14. reconcile: P165 siempre; apply_count 0 si disabled; cutover filter", () => {
    assert.match(reconcile, /agenda_sheet_ops_upsert_batch/);
    assert.match(reconcile, /operational_apply_enabled/);
    assert.match(reconcile, /operational_apply_from_date/);
    assert.match(reconcile, /applyEngineOn/);
    assert.match(reconcile, /BEFORE_CUTOVER|apply_before_cutover/);
    // upsert ocurre aunque apply esté off
    const upsertIdx = reconcile.indexOf("agenda_sheet_ops_upsert_batch");
    const engineIdx = reconcile.indexOf("if (!applyEngineOn)");
    assert.ok(upsertIdx > 0 && engineIdx > upsertIdx);
  });
});
