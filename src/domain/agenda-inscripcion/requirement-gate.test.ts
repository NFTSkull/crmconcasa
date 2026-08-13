import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateInscripcionRequirementGate,
  getInscripcionRequirementsConfig,
} from "./requirement-gate";
import { parseInscripcionRequirementsFromDate } from "./env-gate";

const VALID = {
  kind: "biometricos",
  biometric_result_class: "COMPLETED",
  inscripcion_rebook_required: true,
  booking_id: "11111111-1111-4111-8111-111111111111",
  expediente_id: "22222222-2222-4222-8222-222222222222",
  organization_id: "33333333-3333-4333-8333-333333333333",
  booking_date: "2026-08-13",
  sheet_id: 1,
  sheet_row: 10,
} as const;

describe("P175 B5.1 requirement gate", () => {
  it("env ausente → DISABLED", () => {
    const c = getInscripcionRequirementsConfig({});
    assert.equal(c.enabled, false);
    assert.equal(c.fromDate, null);
    assert.equal(
      evaluateInscripcionRequirementGate({ config: c, row: VALID }).outcome,
      "DISABLED",
    );
  });

  it("ENABLED truthy variants + FROM_DATE", () => {
    for (const v of ["true", "1", "yes", "on", "TRUE", "Yes"]) {
      const c = getInscripcionRequirementsConfig({
        GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED: v,
        GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE: "2026-08-13",
      });
      assert.equal(c.enabled, true, v);
      assert.equal(c.fromDate, "2026-08-13", v);
    }
  });

  it("ENABLED true + FROM_DATE missing/invalid → DISABLED_NO_CUTOVER", () => {
    assert.equal(parseInscripcionRequirementsFromDate("2026-02-30"), null);
    assert.equal(
      evaluateInscripcionRequirementGate({
        config: getInscripcionRequirementsConfig({
          GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED: "true",
        }),
        row: VALID,
      }).outcome,
      "DISABLED_NO_CUTOVER",
    );
    assert.equal(
      evaluateInscripcionRequirementGate({
        config: getInscripcionRequirementsConfig({
          GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED: "true",
          GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE: "13-08-2026",
        }),
        row: VALID,
      }).outcome,
      "DISABLED_NO_CUTOVER",
    );
  });

  it("histórico 07 AGO < cutoff → BEFORE_CUTOVER", () => {
    const c = getInscripcionRequirementsConfig({
      GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED: "true",
      GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE: "2026-08-13",
    });
    const g = evaluateInscripcionRequirementGate({
      config: c,
      row: { ...VALID, booking_date: "2026-08-07" },
    });
    assert.equal(g.allow, false);
    assert.equal(g.outcome, "BEFORE_CUTOVER");
  });

  it("futuro válido 13 AGO → CREATABLE", () => {
    const c = getInscripcionRequirementsConfig({
      GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED: "true",
      GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE: "2026-08-13",
    });
    const g = evaluateInscripcionRequirementGate({ config: c, row: VALID });
    assert.equal(g.allow, true);
    assert.equal(g.outcome, "CREATABLE");
  });

  it("señales inválidas → NOT_REQUIRED / MISSING_IDENTITY", () => {
    const c = getInscripcionRequirementsConfig({
      GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED: "true",
      GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE: "2026-08-13",
    });
    const cases: Array<{ row: Record<string, unknown>; out: string }> = [
      { row: { ...VALID, kind: "firmas" }, out: "NOT_REQUIRED" },
      { row: { ...VALID, kind: "inscripcion" }, out: "NOT_REQUIRED" },
      {
        row: { ...VALID, biometric_result_class: "PENDING" },
        out: "NOT_REQUIRED",
      },
      {
        row: { ...VALID, biometric_result_class: "FAILED_OR_NOT_ATTENDED" },
        out: "NOT_REQUIRED",
      },
      {
        row: { ...VALID, biometric_result_class: "UNKNOWN" },
        out: "NOT_REQUIRED",
      },
      {
        row: { ...VALID, inscripcion_rebook_required: false },
        out: "NOT_REQUIRED",
      },
      { row: { ...VALID, booking_id: null }, out: "MISSING_IDENTITY" },
      { row: { ...VALID, expediente_id: null }, out: "MISSING_IDENTITY" },
      { row: { ...VALID, organization_id: "" }, out: "MISSING_IDENTITY" },
    ];
    for (const caze of cases) {
      assert.equal(
        evaluateInscripcionRequirementGate({
          config: c,
          row: caze.row,
        }).outcome,
        caze.out,
        JSON.stringify(caze.row),
      );
    }
  });
});

describe("P175 B5.1 Edge wiring contracts", () => {
  const root = join(process.cwd());

  it("reconcile: requirement creator ANTES de applyEngineOn continue", () => {
    const src = readFileSync(
      join(root, "supabase/functions/agenda-sheet-reconcile/index.ts"),
      "utf8",
    );
    const opsPos = src.indexOf("agenda_sheet_ops_upsert_batch");
    // Call-site con '(', no el import del helper.
    const maybeReq = src.indexOf("maybeCreateInscripcionRequirement(");
    const applyGate = src.indexOf("if (!applyEngineOn)");
    assert.ok(opsPos >= 0);
    assert.ok(maybeReq > opsPos, "requirement after ops upsert");
    assert.ok(applyGate > maybeReq, "P170 after requirement");
  });

  it("webhook: requirement creator ANTES de evaluateOperationalApplyGate", () => {
    const src = readFileSync(
      join(root, "supabase/functions/agenda-sheet-webhook/index.ts"),
      "utf8",
    );
    const fn = src.indexOf("async function upsertAndApplyOperationalResultRow");
    const slice = src.slice(fn, fn + 5500);
    const opsUpsert = slice.indexOf("agenda_sheet_ops_upsert_batch");
    const maybeReq = slice.indexOf("maybeCreateInscripcionRequirement(");
    const applyGate = slice.indexOf("evaluateOperationalApplyGate");
    assert.ok(opsUpsert >= 0);
    assert.ok(maybeReq > opsUpsert, "requirement after ops upsert");
    assert.ok(applyGate > maybeReq, "P170 after requirement");
    assert.match(slice, /error:\s*opsErr|opsErr/);
  });

  it("shared helper exists and does not touch worker/live-sync", () => {
    const helper = readFileSync(
      join(
        root,
        "supabase/functions/_shared/agenda-sheets/inscripcion-requirement.ts",
      ),
      "utf8",
    );
    assert.match(helper, /agenda_inscripcion_require_from_sheet/);
    assert.match(helper, /BEFORE_CUTOVER/);
    assert.doesNotMatch(
      readFileSync(
        join(root, "supabase/functions/agenda-sheet-sync-worker/index.ts"),
        "utf8",
      ),
      /maybeCreateInscripcionRequirement/,
    );
    assert.doesNotMatch(
      readFileSync(
        join(root, "supabase/functions/agenda-sheet-live-sync/index.ts"),
        "utf8",
      ),
      /maybeCreateInscripcionRequirement/,
    );
  });
});
