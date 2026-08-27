import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePhysicalInventoryFromGrid } from "./sheet-inventory";
import {
  applyAppendOnlyPlanToGrid,
  buildFirmasAppendOnlyTabPlan,
  firmasHourlyBookableCap,
  FIRMAS_SHEET_READ_RANGE_LAST_ROW,
} from "./firmas-append-only-planner";
import { effectiveSlotRemainingWithDaily } from "./daily-capacity";

function blankRow(): string[] {
  return [];
}

describe("P212 Fase 1.6 duplicate Firmas sections", () => {
  it("MONTERREY FIRMAS legacy + appended target → ambos bloques en inventory", () => {
    const grid = [
      ["MONTERREY FIRMAS"],
      ["08:30"],
      ["09:00"],
      ["09:00"],
      ["09:00"],
      ["09:30"],
      ["10:00"],
      ["10:00"],
      ["10:00"],
      ["MONTERREY BIOMETRICOS"],
      ["08:00", "bio"],
      ["APODACA BIOMETRICOS"],
      ["09:00"],
      // appended block AFTER all existing sections
      ["MONTERREY FIRMAS"],
      ["08:00"],
      ["08:00"],
      ["08:00"],
      ["08:00"],
      ["08:00"],
      ["09:00"],
      ["09:00"],
      ["10:00"],
      ["10:00"],
      ["APODACA FIRMAS"],
      ["08:00"],
      ["08:00"],
      ["08:00"],
      ["08:00"],
      ["08:00"],
      ["09:00"],
      ["09:00"],
      ["09:00"],
      ["09:00"],
      ["09:00"],
      ["10:00"],
      ["10:00"],
      ["10:00"],
      ["10:00"],
      ["10:00"],
    ];
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-16",
      sheetTitle: "16 SEPTIEMBRE",
      sheetId: 99,
      grid,
    });

    const mtyFirmas = rows.filter((r) => r.kind === "firmas" && r.locationId === "monterrey");
    const apoFirmas = rows.filter((r) => r.kind === "firmas" && r.locationId === "apodaca");
    const bio = rows.filter((r) => r.kind === "biometricos");

    assert.equal(
      mtyFirmas.filter((r) => r.sheetSlotTime === "08:00").length,
      5,
    );
    assert.equal(
      mtyFirmas.filter((r) => r.sheetSlotTime === "09:00").length,
      5, // 3 legacy + 2 appended
    );
    assert.equal(
      mtyFirmas.filter((r) => r.sheetSlotTime === "10:00").length,
      5,
    );
    assert.equal(
      mtyFirmas.filter((r) => r.sheetSlotTime === "08:30").length,
      1,
    );
    assert.equal(apoFirmas.filter((r) => r.sheetSlotTime === "08:00").length, 5);
    assert.equal(apoFirmas.filter((r) => r.sheetSlotTime === "09:00").length, 5);
    assert.equal(apoFirmas.filter((r) => r.sheetSlotTime === "10:00").length, 5);
    assert.ok(bio.length >= 2);

    const keys = rows.map((r) => r.slotKey);
    assert.equal(keys.length, new Set(keys).size, "slot_key duplicates");

    // Biométricos rows keep pre-append coordinates
    const bioRows = bio.map((r) => r.sheetRow).sort((a, b) => a - b);
    assert.deepEqual(bioRows.slice(0, 2), [11, 13]);
  });

  it("no mezcla sede/kind entre bloques duplicados", () => {
    const grid = [
      ["APODACA FIRMAS"],
      ["10:30"],
      ["MONTERREY FIRMAS"],
      ["08:30"],
      ["MONTERREY BIOMETRICOS"],
      ["08:00"],
      ["APODACA FIRMAS"],
      ["08:00"],
      ["MONTERREY FIRMAS"],
      ["08:00"],
    ];
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-16",
      sheetTitle: "Dup",
      sheetId: 1,
      grid,
    });
    const apo0800 = rows.filter(
      (r) => r.kind === "firmas" && r.locationId === "apodaca" && r.sheetSlotTime === "08:00",
    );
    const mty0800 = rows.filter(
      (r) => r.kind === "firmas" && r.locationId === "monterrey" && r.sheetSlotTime === "08:00",
    );
    assert.equal(apo0800.length, 1);
    assert.equal(apo0800[0]!.sheetRow, 8);
    assert.equal(mty0800.length, 1);
    assert.equal(mty0800[0]!.sheetRow, 10);
  });
});

describe("P212 Fase 1.6 append-only planner", () => {
  it("calcula déficit por tab (MTY 0/3/3 → add 5/2/2; APO 0/0/0 → 5/5/5)", () => {
    const firmasRows = [
      ...Array.from({ length: 3 }, (_, i) => ({
        sheet_row: 10 + i,
        location_id: "monterrey" as const,
        slot_time: "09:00",
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        sheet_row: 20 + i,
        location_id: "monterrey" as const,
        slot_time: "10:00",
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        sheet_row: 3 + i,
        location_id: "apodaca" as const,
        slot_time: "10:30",
      })),
    ];
    const plan = buildFirmasAppendOnlyTabPlan({
      date: "2026-09-16",
      sheetId: 1,
      sheetTitle: "16 SEPTIEMBRE",
      firmasRows,
      lastUsedRowPre: 50,
      gridRowCount: 1000,
      templateContractKnown: true,
      templateRowBySede: { monterrey: 10, apodaca: 3 },
    });
    assert.equal(plan.monterrey["08:00"].add, 5);
    assert.equal(plan.monterrey["09:00"].add, 2);
    assert.equal(plan.monterrey["10:00"].add, 2);
    assert.equal(plan.mtyAddTotal, 9);
    assert.equal(plan.apoAddTotal, 15);
    assert.equal(plan.firstAppendRow, 51);
    // 1 header MTY + 9 slots + 1 header APO + 15 slots = 26
    assert.equal(plan.plannedAppendRows, 26);
    assert.equal(plan.lastAppendRow, 76);
    assert.equal(plan.withinReadRange200, true);
    assert.equal(plan.decision, "SAFE_APPEND_ONLY");
    assert.equal(plan.appendDimensionNeeded, false);
    assert.ok(plan.actions.some((a) => a.type === "forbidden_insert_mid_sheet"));
    assert.ok(!plan.actions.some((a) => a.type === "append_dimension_rows"));
  });

  it("STOP_RANGE_LIMIT si lastAppendRow > 200", () => {
    const plan = buildFirmasAppendOnlyTabPlan({
      date: "2026-09-16",
      sheetId: 1,
      sheetTitle: "Tight",
      firmasRows: [],
      lastUsedRowPre: 190,
      gridRowCount: 1000,
      templateContractKnown: true,
    });
    assert.equal(plan.decision, "STOP_RANGE_LIMIT");
    assert.equal(plan.withinReadRange200, false);
    assert.ok((plan.lastAppendRow) > FIRMAS_SHEET_READ_RANGE_LAST_ROW);
  });

  it("appendDimensionNeeded si gridRowCount insuficiente (sin mid insert)", () => {
    const plan = buildFirmasAppendOnlyTabPlan({
      date: "2026-09-16",
      sheetId: 1,
      sheetTitle: "Short grid",
      firmasRows: [],
      lastUsedRowPre: 50,
      gridRowCount: 55,
      templateContractKnown: true,
    });
    assert.equal(plan.appendDimensionNeeded, true);
    assert.ok(plan.actions.some((a) => a.type === "append_dimension_rows"));
    assert.equal(plan.decision, "SAFE_APPEND_ONLY");
  });

  it("simulación: preGrid + append → 5/5/5 y bio rows unchanged", () => {
    const preGrid = [
      ["APODACA FIRMAS"],
      ["10:30"],
      ["10:30"],
      ["10:30"],
      ["MONTERREY FIRMAS"],
      ["08:30"],
      ["09:00"],
      ["09:00"],
      ["09:00"],
      ["09:30"],
      ["10:00"],
      ["10:00"],
      ["10:00"],
      ["MONTERREY BIOMETRICOS"],
      ["08:00", "nss", "nom"],
      ["APODACA BIOMETRICOS"],
      ["09:00", "x"],
    ];
    const lastUsed = preGrid.length;
    const firmasRows = [
      { sheet_row: 2, location_id: "apodaca", slot_time: "10:30" },
      { sheet_row: 3, location_id: "apodaca", slot_time: "10:30" },
      { sheet_row: 4, location_id: "apodaca", slot_time: "10:30" },
      { sheet_row: 6, location_id: "monterrey", slot_time: "08:30" },
      { sheet_row: 7, location_id: "monterrey", slot_time: "09:00" },
      { sheet_row: 8, location_id: "monterrey", slot_time: "09:00" },
      { sheet_row: 9, location_id: "monterrey", slot_time: "09:00" },
      { sheet_row: 10, location_id: "monterrey", slot_time: "09:30" },
      { sheet_row: 11, location_id: "monterrey", slot_time: "10:00" },
      { sheet_row: 12, location_id: "monterrey", slot_time: "10:00" },
      { sheet_row: 13, location_id: "monterrey", slot_time: "10:00" },
    ];
    const plan = buildFirmasAppendOnlyTabPlan({
      date: "2026-09-16",
      sheetId: 7,
      sheetTitle: "Sim",
      firmasRows,
      lastUsedRowPre: lastUsed,
      gridRowCount: 500,
      templateContractKnown: true,
      templateRowBySede: { monterrey: 7, apodaca: 2 },
    });
    const post = applyAppendOnlyPlanToGrid(preGrid, plan);

    // Preexisting rows unchanged
    for (let i = 0; i < lastUsed; i++) {
      assert.deepEqual(post[i], [...preGrid[i]!], `row ${i + 1} mutated`);
    }

    const { rows: preRows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-16",
      sheetTitle: "Sim",
      sheetId: 7,
      grid: preGrid,
    });
    const { rows: postRows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-16",
      sheetTitle: "Sim",
      sheetId: 7,
      grid: post,
    });

    const preBio = preRows.filter((r) => r.kind === "biometricos");
    const postBio = postRows.filter((r) => r.kind === "biometricos");
    assert.equal(preBio.length, postBio.length);
    for (const b of preBio) {
      const after = postBio.find((x) => x.sheetRow === b.sheetRow);
      assert.ok(after);
      assert.equal(after!.slotKey, b.slotKey);
      assert.equal(after!.visibleNss, b.visibleNss);
    }

    const mty = postRows.filter((r) => r.kind === "firmas" && r.locationId === "monterrey");
    const apo = postRows.filter((r) => r.kind === "firmas" && r.locationId === "apodaca");
    for (const h of ["08:00", "09:00", "10:00"] as const) {
      assert.equal(mty.filter((r) => r.sheetSlotTime === h).length, 5, `mty ${h}`);
      assert.equal(apo.filter((r) => r.sheetSlotTime === h).length, 5, `apo ${h}`);
    }
    const keys = postRows.map((r) => r.slotKey);
    assert.equal(keys.length, new Set(keys).size);
  });
});

describe("P212 Fase 1.6 physical cannot raise hourly cap", () => {
  it("physical 7 + hourly 5 → bookable 5", () => {
    assert.equal(
      firmasHourlyBookableCap({ physicalAvailable: 7, hourlyLogicalCap: 5, dailyRemaining: 15 }),
      5,
    );
    assert.equal(
      effectiveSlotRemainingWithDaily({
        perHourRemaining: 5,
        physicalAvailable: 7,
        dailyRemaining: 15,
      }),
      5,
    );
  });
});

void blankRow;
