/**
 * P212 Fase 1.8 — canonical template + simulación 22 tabs (0 Sheet writes).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parsePhysicalInventoryFromGrid } from "./sheet-inventory";
import {
  applyAppendOnlyPlanToGrid,
  buildFirmasAppendOnlyTabPlan,
  firmasHourlyBookableCap,
  type FirmasInventoryPhysicalRow,
} from "./firmas-append-only-planner";
import {
  buildFirmasCanonicalTemplates,
  evaluateCanonicalTemplateGate,
  firmasProvisionerProcessSteps,
  generateCanonicalAppendedBlock,
} from "./firmas-canonical-template";
import {
  computeFirmasProvisionDeficit,
  firmasBookGateRespectsPhysicalRows,
  simulateIdempotentProvisionPasses,
} from "./firmas-future-tabs-provisioning";
import {
  classifyCanonicalTemplateDecision,
  classifyFirmasFormula,
  isFormatSourceFirmasRow,
  pickPerHourFormatSources,
  redactRow,
} from "../../../supabase/functions/_shared/agenda-sheets/structure-audit.ts";

type PlanTab = {
  date: string;
  sheetId: number;
  sheetTitle: string;
  lastUsedRowPre: number;
  MTY_08: { current: number; add: number; final: number };
  MTY_09: { current: number; add: number; final: number };
  MTY_10: { current: number; add: number; final: number };
  APO_08: { current: number; add: number; final: number };
  APO_09: { current: number; add: number; final: number };
  APO_10: { current: number; add: number; final: number };
  bioRows: number;
  lastAppendRow: number;
};

function loadP216Plan(): { tabs: PlanTab[]; maxLastAppendRow: number } | null {
  const candidates = [
    `${process.env.HOME}/Desktop/concasa-firmas-p1-backup/firmas-p216-append-only-plan.json`,
    "/Users/grecovillanuevaortiz/Desktop/concasa-firmas-p1-backup/firmas-p216-append-only-plan.json",
  ];
  for (const p of candidates) {
    try {
      const d = JSON.parse(readFileSync(p, "utf8")) as {
        tabs: PlanTab[];
        maxLastAppendRow: number;
      };
      return d;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Grid sintético RO que reproduce counts físicos pre-append del plan. */
function syntheticPreGrid(tab: PlanTab): string[][] {
  const grid: string[][] = [];
  // Orphan APO legacy 10:30 (sin header) — recovery parser.
  const apoLegacy = Math.max(0, 3); // típico 3×10:30
  grid.push([""]);
  for (let i = 0; i < apoLegacy; i++) grid.push(["10:30"]);

  grid.push(["MONTERREY FIRMAS"]);
  for (let i = 0; i < 3; i++) grid.push(["08:30"]);
  for (let i = 0; i < tab.MTY_09.current; i++) grid.push(["09:00"]);
  for (let i = 0; i < 3; i++) grid.push(["09:30"]);
  for (let i = 0; i < tab.MTY_10.current; i++) grid.push(["10:00"]);
  // MTY_08 current suele 0

  grid.push(["MONTERREY BIOMETRICOS"]);
  const bioHalf = Math.max(1, Math.floor(tab.bioRows / 2));
  for (let i = 0; i < bioHalf; i++) grid.push(["08:00", "bio"]);

  grid.push(["APODACA BIOMETRICOS"]);
  for (let i = 0; i < tab.bioRows - bioHalf; i++) grid.push(["09:00", "bio"]);

  // Pad hasta lastUsedRowPre
  while (grid.length < tab.lastUsedRowPre) grid.push([]);
  return grid;
}

function countPhysical(
  rows: readonly { kind: string; locationId: string; sheetSlotTime: string }[],
  sede: string,
  hour: string,
): number {
  return rows.filter(
    (r) =>
      r.kind === "firmas" &&
      r.locationId === sede &&
      String(r.sheetSlotTime).slice(0, 5) === hour,
  ).length;
}

describe("P212 Fase 1.8 FirmasCanonicalTemplate", () => {
  it("construye templates por hora MTY + APO; gate READY si todos known", () => {
    const built = buildFirmasCanonicalTemplates({
      headerFormatFingerprint: "ff5876a12",
      mty: {
        "08:00": {
          sourceRow: 11,
          sourceHour: "08:30",
          fp: "fmty08",
          rowHeight: 21,
          validations: ["E", "F"],
        },
        "09:00": {
          sourceRow: 12,
          sourceHour: "09:00",
          fp: "fmty09",
          rowHeight: 21,
          validations: ["E", "F"],
        },
        "10:00": {
          sourceRow: 20,
          sourceHour: "10:00",
          fp: "fmty10",
          rowHeight: 21,
          validations: ["E", "F"],
        },
      },
      apo: {
        sourceRow: 3,
        sourceHour: "10:30",
        fp: "fapo",
        rowHeight: 21,
        validations: ["E", "F"],
      },
    });
    assert.equal(built.allKnown, true);
    assert.equal(built.monterrey08.sourceFormatHour, "08:30");
    assert.equal(built.apodaca.header.text, "APODACA FIRMAS");
    assert.equal(built.apodaca.header.mergeSpan, 7);
    assert.equal(built.monterrey08.row.pasteNormal, "FORBIDDEN");
    assert.equal(built.monterrey08.row.formulasInNewRows, false);
    assert.equal(
      evaluateCanonicalTemplateGate({
        headerCanonicalKnown: true,
        mty08Known: true,
        mty09Known: true,
        mty10Known: true,
        apoCanonicalKnown: true,
        formulasStructuralRequired: false,
      }),
      "READY_FOR_CONTROLLED_APPEND_APPLY",
    );
  });

  it("occupied row OK como format source; same-fingerprint-across-hours NO es gate", () => {
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
          occupied ? { userEnteredValue: { stringValue: "NSS" } } : {},
        ],
      });
    const rows = [
      mk(2, "08:30", true),
      mk(3, "09:00", true),
      mk(4, "10:00", true),
    ];
    assert.equal(isFormatSourceFirmasRow(rows[0]!), true);
    const per = pickPerHourFormatSources({
      sede: "monterrey",
      rows,
      parseTime,
    });
    assert.equal(per.find((p) => p.targetHour === "08:00")?.sourceHourPreferred, "08:30");
    assert.equal(per.every((p) => p.sourceRow != null), true);
    assert.equal(
      classifyCanonicalTemplateDecision({
        headerMtyKnown: true,
        mtyPerHour: per,
        apoPerHour: pickPerHourFormatSources({
          sede: "apodaca",
          rows: [mk(1, "10:30", true)],
          parseTime,
        }),
        formulasRequireStructuralCopy: false,
      }),
      "SAFE_CANONICAL_APPEND",
    );
    assert.equal(classifyFirmasFormula("E", true), "HISTORICAL_OR_BOOKING_SPECIFIC");
  });

  it("generated block usa déficit real (no hardcode)", () => {
    const b = generateCanonicalAppendedBlock({
      mtyAdd: { "08:00": 5, "09:00": 2, "10:00": 2 },
      apoAdd: { "08:00": 5, "09:00": 5, "10:00": 5 },
    });
    assert.equal(b.lines[0], "MONTERREY FIRMAS");
    assert.equal(b.lines.filter((l) => l === "08:00").length, 10); // 5 mty + 5 apo
    assert.ok(b.lines.includes("APODACA FIRMAS"));
    assert.equal(firmasProvisionerProcessSteps().length, 8);
  });
});

describe("P212 Fase 1.8 simulación 22 tabs append canónico", () => {
  it("22/22 → physical 5/5/5 MTY+APO, slot_key dup=0, bio Δ=0, preexisting unchanged", () => {
    const plan = loadP216Plan();
    assert.ok(plan, "backup p216 plan required");
    assert.equal(plan!.tabs.length, 22);

    let safe = 0;
    let maxAppend = 0;
    let slotDupTotal = 0;
    let bioChanged = 0;
    let preexistingChanged = 0;

    for (const tab of plan!.tabs) {
      const preGrid = syntheticPreGrid(tab);
      const preParsed = parsePhysicalInventoryFromGrid({
        bookingDate: tab.date,
        sheetTitle: tab.sheetTitle,
        sheetId: tab.sheetId,
        grid: preGrid,
      });
      const preBio = preParsed.rows
        .filter((r) => r.kind === "biometricos")
        .map((r) => ({ row: r.sheetRow, key: r.slotKey, a: r.sheetSlotTime }));
      const preFirmasCoords = preParsed.rows
        .filter((r) => r.kind === "firmas")
        .map((r) => ({ row: r.sheetRow, key: r.slotKey, a: r.sheetSlotTime, sede: r.locationId }));

      const firmasRows: FirmasInventoryPhysicalRow[] = preParsed.rows
        .filter((r) => r.kind === "firmas")
        .map((r) => ({
          sheet_row: r.sheetRow,
          location_id: r.locationId,
          slot_time: r.sheetSlotTime,
          status: r.status,
        }));

      // Override counts to match Cloud plan deficits exactly for append sizing.
      const planRows: FirmasInventoryPhysicalRow[] = [];
      let fakeRow = 1;
      for (const [sede, hour, n] of [
        ["monterrey", "08:00", tab.MTY_08.current],
        ["monterrey", "09:00", tab.MTY_09.current],
        ["monterrey", "10:00", tab.MTY_10.current],
        ["apodaca", "08:00", tab.APO_08.current],
        ["apodaca", "09:00", tab.APO_09.current],
        ["apodaca", "10:00", tab.APO_10.current],
      ] as const) {
        for (let i = 0; i < n; i++) {
          planRows.push({
            sheet_row: fakeRow++,
            location_id: sede,
            slot_time: hour,
          });
        }
      }
      void firmasRows;

      const appendPlan = buildFirmasAppendOnlyTabPlan({
        date: tab.date,
        sheetId: tab.sheetId,
        sheetTitle: tab.sheetTitle,
        firmasRows: planRows,
        lastUsedRowPre: tab.lastUsedRowPre,
        templateContractKnown: true,
      });
      assert.equal(appendPlan.decision, "SAFE_APPEND_ONLY", tab.sheetTitle);
      assert.equal(appendPlan.mtyAddTotal, tab.MTY_08.add + tab.MTY_09.add + tab.MTY_10.add);
      assert.equal(appendPlan.apoAddTotal, tab.APO_08.add + tab.APO_09.add + tab.APO_10.add);

      const postGrid = applyAppendOnlyPlanToGrid(preGrid, appendPlan);
      const postParsed = parsePhysicalInventoryFromGrid({
        bookingDate: tab.date,
        sheetTitle: tab.sheetTitle,
        sheetId: tab.sheetId,
        grid: postGrid,
      });

      const mty08 = countPhysical(postParsed.rows, "monterrey", "08:00");
      const mty09 = countPhysical(postParsed.rows, "monterrey", "09:00");
      const mty10 = countPhysical(postParsed.rows, "monterrey", "10:00");
      const apo08 = countPhysical(postParsed.rows, "apodaca", "08:00");
      const apo09 = countPhysical(postParsed.rows, "apodaca", "09:00");
      const apo10 = countPhysical(postParsed.rows, "apodaca", "10:00");

      // Physical target = preexisting (synthetic) + appended. Plan finals are 5.
      // synthetic may have extra legacy 08:30/09:30/10:30 — targets must hit ≥5 and exact plan final for 08/09/10.
      assert.equal(mty08, tab.MTY_08.final, `${tab.sheetTitle} MTY08`);
      assert.equal(mty09, tab.MTY_09.final, `${tab.sheetTitle} MTY09`);
      assert.equal(mty10, tab.MTY_10.final, `${tab.sheetTitle} MTY10`);
      // APO: orphan 10:30 + appended 08/09/10 — 08/09/10 deben ser exact finals
      assert.equal(apo08, tab.APO_08.final, `${tab.sheetTitle} APO08`);
      assert.equal(apo09, tab.APO_09.final, `${tab.sheetTitle} APO09`);
      assert.equal(apo10, tab.APO_10.final, `${tab.sheetTitle} APO10`);

      const keys = postParsed.rows.map((r) => r.slotKey);
      const dup = keys.length - new Set(keys).size;
      slotDupTotal += dup;
      assert.equal(dup, 0, `${tab.sheetTitle} slot_key dup`);

      const postBio = postParsed.rows
        .filter((r) => r.kind === "biometricos")
        .map((r) => ({ row: r.sheetRow, key: r.slotKey, a: r.sheetSlotTime }));
      if (JSON.stringify(preBio) !== JSON.stringify(postBio)) bioChanged += 1;

      for (const p of preFirmasCoords) {
        const still = postParsed.rows.find(
          (r) => r.sheetRow === p.row && r.kind === "firmas",
        );
        if (
          !still ||
          still.slotKey !== p.key ||
          still.sheetSlotTime !== p.a ||
          still.locationId !== p.sede
        ) {
          preexistingChanged += 1;
          break;
        }
      }

      maxAppend = Math.max(maxAppend, appendPlan.lastAppendRow);
      safe += 1;

      // Worker sim: elige fila appended available; escribe solo B:D+O:U mentalmente
      const appendedAvailable = postParsed.rows.filter(
        (r) =>
          r.kind === "firmas" &&
          r.status === "available" &&
          r.sheetRow > tab.lastUsedRowPre &&
          (r.sheetSlotTime === "08:00" ||
            r.sheetSlotTime === "09:00" ||
            r.sheetSlotTime === "10:00"),
      );
      assert.ok(appendedAvailable.length > 0, `${tab.sheetTitle} worker pool`);
      const pick = appendedAvailable[0]!;
      assert.ok(pick.sheetRow > tab.lastUsedRowPre);
      // Live-sync book_gate physical
      const avail08 = postParsed.rows.filter(
        (r) =>
          r.kind === "firmas" &&
          r.locationId === "monterrey" &&
          r.sheetSlotTime === "08:00" &&
          r.status === "available",
      ).length;
      const gate = firmasHourlyBookableCap({
        physicalAvailable: avail08,
        hourlyLogicalCap: 5,
        dailyRemaining: 15,
      });
      assert.ok(gate <= 5);
      assert.ok(gate <= avail08);
    }

    assert.equal(safe, 22);
    assert.equal(slotDupTotal, 0);
    assert.equal(bioChanged, 0);
    assert.equal(preexistingChanged, 0);
    assert.ok(maxAppend <= 200);
    assert.ok(maxAppend <= plan!.maxLastAppendRow || maxAppend <= 84);
  });

  it("provisioner idempotente + future tab fail-closed", () => {
    const passes = simulateIdempotentProvisionPasses({
      initialCounts: { "08:00": 0, "09:00": 3, "10:00": 3 },
      passes: 2,
    });
    assert.equal(passes[0]!.addTotal, 9); // 5+2+2
    assert.equal(passes[1]!.addTotal, 0);
    const d = computeFirmasProvisionDeficit({
      sede: "apodaca",
      physicalCountsByHour: { "08:00": 5, "09:00": 5, "10:00": 5 },
    });
    assert.equal(d.addTotal, 0);
    const gate = firmasBookGateRespectsPhysicalRows({
      sqlHourlyCapacity: 5,
      physicalAvailableRows: 0,
    });
    assert.equal(gate.allowBookSlots, 0);
    assert.equal(gate.reason, "PHYSICAL_SHEET_LIMIT_FAIL_CLOSED");
  });
});
