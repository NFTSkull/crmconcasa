/**
 * P173 B1 — contrato TypeScript/Edge: red veto flags (sin SQL migration).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  buildOperationalResultFromRow,
  buildOperationalResultUpsertRows,
  classifyOperationalRow,
} from "./operational-results";
import { classifyBiometricResult } from "./operational-result-classifiers";
import { APPLY_BUSINESS_OUTCOMES } from "./operational-apply-rpc";
import type { EffectiveBackground } from "./effective-background";

const ORG = "00000000-0000-4000-9170-000000000001";
const BOOK = "00000000-0000-4000-9170-000000000201";
const EXP = "00000000-0000-4000-9170-000000000101";

const RED: EffectiveBackground = { red: 1, green: 0, blue: 0 };
const WHITE: EffectiveBackground = { red: 1, green: 1, blue: 1 };

function padRow(cells: Record<number, string>): string[] {
  const row: string[] = Array.from({ length: 21 }, () => "");
  for (const [k, v] of Object.entries(cells)) {
    row[Number(k)] = v;
  }
  return row;
}

const bioGrid = [
  ["MONTERREY BIOMETRICOS"],
  [
    "HORA",
    "NSS",
    "NOMBRE",
    "ASESOR",
    "BIOMETRICOS",
    "NOTIFICACION",
    "",
    "NOTAS",
  ],
  padRow({
    0: "08:30",
    4: "CESI MTY",
    5: "YA CON BETTY",
    15: BOOK,
    16: EXP,
  }),
];

describe("P173 B1 builders red flags", () => {
  it("sin backgrounds → flags false", () => {
    const rows = buildOperationalResultUpsertRows({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "12 AGOSTO",
      bookingDate: "2026-08-12",
      grid: bioGrid,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.biometric_cell_red, false);
    assert.equal(rows[0]?.notification_cell_red, false);
    assert.equal(rows[0]?.signature_cell_red, false);
    assert.equal(rows[0]?.operational_red_veto, false);

    const one = buildOperationalResultFromRow({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "t",
      bookingDate: "2026-08-12",
      sheetRow: 3,
      kind: "biometricos",
      locationId: "monterrey",
      row: padRow({ 0: "08:30", 4: "CESI MTY", 15: BOOK, 16: EXP }),
    });
    assert.ok(one);
    assert.equal(one.operational_red_veto, false);
    assert.equal(one.biometric_cell_red, false);
  });

  it("F red → notification_cell_red + veto (biometricos)", () => {
    // fila grid index 2 = data row; E:I = [E,F,G,H,I]
    const backgroundsEi: EffectiveBackground[][] = [
      [],
      [],
      [WHITE, RED, null, null, null],
    ];
    const rows = buildOperationalResultUpsertRows({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "12 AGOSTO",
      bookingDate: "2026-08-12",
      grid: bioGrid,
      backgroundsEi,
    });
    assert.equal(rows[0]?.notification_cell_red, true);
    assert.equal(rows[0]?.biometric_cell_red, false);
    assert.equal(rows[0]?.operational_red_veto, true);
    assert.deepEqual(rows[0]?.operational_red_columns, ["F"]);
  });

  it("H red → veto sin biometric_cell_red", () => {
    const ei: EffectiveBackground[] = [WHITE, WHITE, WHITE, RED, WHITE];
    const one = buildOperationalResultFromRow({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "t",
      bookingDate: "2026-08-12",
      sheetRow: 5,
      kind: "biometricos",
      locationId: "monterrey",
      row: padRow({ 0: "08:30", 4: "CESI MTY", 15: BOOK, 16: EXP }),
      eiBackgrounds: ei,
    });
    assert.ok(one);
    assert.equal(one.operational_red_veto, true);
    assert.equal(one.biometric_cell_red, false);
    assert.equal(one.notification_cell_red, false);
    assert.deepEqual(one.operational_red_columns, ["H"]);
  });

  it("classifiers unchanged: COMPLETED + red sigue COMPLETED", () => {
    const row = padRow({ 0: "08:30", 4: "CESI MTY", 5: "YA CON BETTY" });
    const c = classifyOperationalRow({ kind: "biometricos", row });
    assert.equal(c.biometric_result_class, "COMPLETED");
    assert.equal(classifyBiometricResult("CESI MTY"), "COMPLETED");
    const withRed = buildOperationalResultFromRow({
      organizationId: ORG,
      spreadsheetId: "ss",
      sheetId: 1,
      sheetTitle: "t",
      bookingDate: "2026-08-12",
      sheetRow: 5,
      kind: "biometricos",
      locationId: "monterrey",
      row,
      eiBackgrounds: [RED, null, null, null, null],
    });
    assert.ok(withRed);
    assert.equal(withRed.biometric_result_class, "COMPLETED");
    assert.equal(withRed.biometric_cell_red, true);
    assert.equal(withRed.operational_red_veto, true);
  });
});

describe("P173 B1 edge + google contracts", () => {
  const reconcile = readFileSync(
    new URL(
      "../../../supabase/functions/agenda-sheet-reconcile/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const webhook = readFileSync(
    new URL(
      "../../../supabase/functions/agenda-sheet-webhook/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const google = readFileSync(
    new URL(
      "../../../supabase/functions/_shared/agenda-sheets/google.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const applyHelper = readFileSync(
    new URL(
      "../../../supabase/functions/_shared/agenda-sheets/apply-operational-result.ts",
      import.meta.url,
    ),
    "utf8",
  );

  it("reconcile: getEffectiveBackgrounds E1:I200 una sola vez por patrón", () => {
    assert.match(reconcile, /getEffectiveBackgrounds/);
    assert.match(reconcile, /E1:I200/);
    const matches = reconcile.match(/getEffectiveBackgrounds\(/g) ?? [];
    assert.equal(matches.length, 1);
    assert.match(
      reconcile,
      /getEffectiveBackgrounds\(\s*`\$\{titleEsc\}!E1:I200`/,
    );
    assert.match(reconcile, /backgroundsEi/);
  });

  it("webhook: E${row}:I${row} en upsertAndApply", () => {
    assert.match(webhook, /getEffectiveBackgrounds/);
    assert.match(
      webhook,
      /E\$\{(?:input\.)?rowNumber\}:I\$\{(?:input\.)?rowNumber\}/,
    );
    const block = webhook.slice(
      webhook.indexOf("async function upsertAndApplyOperationalResultRow"),
      webhook.indexOf("already_synced") > 0
        ? undefined
        : webhook.length,
    );
    assert.match(block, /eiBackgrounds/);
    assert.match(block, /buildOperationalResultFromRow/);
  });

  it("APPLY_BUSINESS_OUTCOMES incluye COLOR_VETO y SKIPPED_CONTINGENCY", () => {
    assert.ok(APPLY_BUSINESS_OUTCOMES.includes("COLOR_VETO"));
    assert.ok(APPLY_BUSINESS_OUTCOMES.includes("SKIPPED_CONTINGENCY"));
    assert.match(applyHelper, /COLOR_VETO/);
    assert.match(applyHelper, /SKIPPED_CONTINGENCY/);
    assert.match(applyHelper, /p_biometric_cell_red/);
    assert.match(applyHelper, /p_operational_red_veto/);
  });

  it("google.ts: getEffectiveBackgrounds + effectiveFormat.backgroundColor", () => {
    assert.match(google, /getEffectiveBackgrounds/);
    assert.match(google, /effectiveFormat\.backgroundColorStyle/);
    assert.match(google, /effectiveFormat\.backgroundColor/);
    assert.match(google, /includeGridData=true/);
    assert.match(google, /parseEffectiveBackgroundGridFromSheetsGet/);
  });
});
