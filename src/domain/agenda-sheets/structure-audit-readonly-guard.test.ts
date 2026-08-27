/**
 * Evidencia estática: agenda-sheet-structure-audit NO puede mutar Sheet.
 * Falla si el código del auditor contiene/invoca APIs de escritura.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildTargetAuContract,
  classifyCanonicalTemplateDecision,
  classifyTabTemplateDecision,
  fingerprint,
  isFormatSourceFirmasRow,
  isReusableFirmasTemplateRow,
  pickFirmasSourceTemplate,
  pickPerHourFormatSources,
  redactRow,
} from "../../../supabase/functions/_shared/agenda-sheets/structure-audit.ts";

const ROOT = join(
  process.cwd(),
  "supabase/functions/agenda-sheet-structure-audit",
);
const RO_ADAPTER = join(
  process.cwd(),
  "supabase/functions/_shared/agenda-sheets/google-readonly-structure.ts",
);
const SHARED_AUDIT = join(
  process.cwd(),
  "supabase/functions/_shared/agenda-sheets/structure-audit.ts",
);

const FORBIDDEN = [
  "updateValues",
  "batchUpdateValues",
  "batchClear",
  "batchUpdateSpreadsheet",
  "insertDimension",
  "appendDimension",
  "deleteDimension",
  "copyPaste",
  "values:batchUpdate",
  "values:batchClear",
  ":batchUpdate",
  "method: \"PUT\"",
  "method: 'PUT'",
  "method: \"POST\"", // structure GET-only hacia Sheets values; OAuth token POST es en adapter — allowlist abajo
] as const;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkTsFiles(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("agenda-sheet-structure-audit read-only by construction", () => {
  it("fuente del Edge + adapter RO no invocan APIs de escritura Sheet", () => {
    const files = [...walkTsFiles(ROOT), RO_ADAPTER, SHARED_AUDIT];
    assert.ok(files.length >= 3);

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      // Adapter RO puede POST solo a oauth2.googleapis.com/token — no a Sheets mutate.
      const sheetsMutatePost =
        /sheets\.googleapis\.com[\s\S]{0,200}method:\s*["']POST["']/.test(src) ||
        /method:\s*["']POST["'][\s\S]{0,200}sheets\.googleapis\.com/.test(src) ||
        /values:batchUpdate|values:batchClear|:batchUpdate/.test(src);

      assert.equal(
        sheetsMutatePost,
        false,
        `${file}: POST mutate hacia Sheets prohibido`,
      );

      for (const token of FORBIDDEN) {
        if (token.startsWith("method:")) {
          // PUT totalmente prohibido; POST solo permitido fuera de Sheets mutate (ya cubierto).
          if (token.includes("PUT")) {
            assert.equal(
              src.includes(token) || /method:\s*["']PUT["']/.test(src),
              false,
              `${file} contiene ${token}`,
            );
          }
          continue;
        }
        assert.equal(
          src.includes(token),
          false,
          `${file} contiene token prohibido: ${token}`,
        );
      }

      // Interfaz RO no debe reexportar adapter de escritura.
      assert.equal(src.includes("createGoogleSheetsAdapter"), false, file);
      assert.equal(
        /(?:^|[^a-zA-Z])SheetsAdapter(?:[^a-zA-Z]|$)/m.test(src),
        false,
        `${file}: tipo SheetsAdapter (escritura) no permitido`,
      );
    }

    const adapterSrc = readFileSync(RO_ADAPTER, "utf8");
    assert.match(adapterSrc, /spreadsheets\.readonly/);
    assert.match(adapterSrc, /ReadOnlyStructureSheetsAdapter/);
    assert.doesNotMatch(adapterSrc, /updateValues/);
  });

  it("redacción: B:U sin texto humano; A conserva estructural", () => {
    const row = redactRow({
      row_number: 12,
      pixelSize: 21,
      hidden: false,
      values: [
        { userEnteredValue: { stringValue: "9:00 AM" } },
        { userEnteredValue: { stringValue: "12345678901" } },
        { userEnteredValue: { stringValue: "Juan Perez" } },
        { userEnteredValue: { stringValue: "EXP-1" } },
        { userEnteredValue: { stringValue: "FIRMO" } },
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        { userEnteredValue: { stringValue: "crm" } },
        { userEnteredValue: { stringValue: "uuid-should-not-leak-as-raw-necessity" } },
      ],
    });
    assert.equal(row.cells[0]?.structuralTextA, "9:00 AM");
    assert.equal(row.cells[1]?.structuralTextA, null);
    assert.equal(row.bdOccupied, true);
    assert.equal(row.enHasHumanResult, true);
    assert.equal(row.ouHasBookingMeta, true);
    assert.equal(isReusableFirmasTemplateRow(row), false);
    const json = JSON.stringify(row);
    assert.equal(json.includes("Juan Perez"), false);
    assert.equal(json.includes("12345678901"), false);
  });

  it("pick template ignora filas ocupadas y clasifica SAFE/STOP", () => {
    const parseTime = (raw: string) => {
      const m = /(\d{1,2}):(\d{2})/.exec(raw);
      if (!m) return null;
      return `${m[1]!.padStart(2, "0")}:${m[2]}`;
    };
    const mk = (row: number, a: string, occupied = false) =>
      redactRow({
        row_number: row,
        pixelSize: 21,
        hidden: false,
        values: [
          { userEnteredValue: { stringValue: a } },
          occupied ? { userEnteredValue: { stringValue: "x" } } : {},
        ],
      });
    const rows = [
      mk(2, "08:30"),
      mk(3, "09:00"),
      mk(4, "10:00", true),
      mk(5, "09:30"),
    ];
    const pick = pickFirmasSourceTemplate({
      sede: "monterrey",
      rows,
      parseTime,
    });
    assert.ok(pick.sourceTemplateRow);
    assert.notEqual(pick.sourceTemplateRow, 4);
    assert.equal(
      classifyTabTemplateDecision({
        mty: pick,
        apo: { ...pick, sede: "apodaca" },
        headerMty: true,
        headerApo: true,
      }),
      "SAFE_APPEND_ONLY",
    );
    assert.equal(
      classifyTabTemplateDecision({
        mty: { ...pick, sourceTemplateRow: null, reason: "missing" },
        apo: pick,
        headerMty: true,
        headerApo: true,
      }),
      "STOP_TEMPLATE_MISSING",
    );
    const contract = buildTargetAuContract({
      sede: "monterrey",
      targetHour: "09:00",
      sourceTemplateRow: pick.sourceTemplateRow,
      templateRow: rows.find((r) => r.row_number === pick.sourceTemplateRow) ?? null,
    });
    assert.equal(contract.OU.inventedTechValues, false);
    assert.equal(contract.BD.role, "blank_initial");
    assert.ok(fingerprint({ a: 1 }).startsWith("f"));
  });

  it("Fase 1.8: occupied format-source + canonical SAFE sin header APO", () => {
    const parseTime = (raw: string) => {
      const m = /(\d{1,2}):(\d{2})/.exec(raw);
      if (!m) return null;
      return `${m[1]!.padStart(2, "0")}:${m[2]}`;
    };
    const mk = (row: number, a: string) =>
      redactRow({
        row_number: row,
        pixelSize: 21,
        hidden: false,
        values: [
          { userEnteredValue: { stringValue: a } },
          { userEnteredValue: { stringValue: "occupied-nss" } },
        ],
      });
    const mty = [mk(10, "08:30"), mk(12, "09:00"), mk(20, "10:00")];
    const apo = [mk(3, "10:30")];
    assert.equal(isFormatSourceFirmasRow(mty[0]!), true);
    const mtyPer = pickPerHourFormatSources({ sede: "monterrey", rows: mty, parseTime });
    const apoPer = pickPerHourFormatSources({ sede: "apodaca", rows: apo, parseTime });
    assert.equal(
      classifyCanonicalTemplateDecision({
        headerMtyKnown: true,
        mtyPerHour: mtyPer,
        apoPerHour: apoPer,
        formulasRequireStructuralCopy: false,
      }),
      "SAFE_CANONICAL_APPEND",
    );
  });
});
