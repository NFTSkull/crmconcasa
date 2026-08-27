/**
 * Hotfix parser: targets físicos Firmas 08/09/10 + legacy.
 * NO cambia booking rules; solo reconocimiento físico / inventory.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePhysicalInventoryFromGrid } from "./sheet-inventory";
import { DEFAULT_BIOMETRICOS_0800_0830_ALIASES } from "./time-aliases";

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

describe("hotfix firmas target times parser", () => {
  it("A) MONTERREY FIRMAS 08/09/10 ×5 → 15 physical", () => {
    const grid = [
      ["MONTERREY FIRMAS"],
      ...Array.from({ length: 5 }, () => ["08:00"]),
      ...Array.from({ length: 5 }, () => ["09:00"]),
      ...Array.from({ length: 5 }, () => ["10:00"]),
    ];
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-30",
      sheetTitle: "30 SEPTIEMBRE",
      sheetId: 1,
      grid,
    });
    const mty = rows.filter((r) => r.kind === "firmas" && r.locationId === "monterrey");
    assert.equal(mty.length, 15);
    assert.equal(countPhysical(rows, "monterrey", "08:00"), 5);
    assert.equal(countPhysical(rows, "monterrey", "09:00"), 5);
    assert.equal(countPhysical(rows, "monterrey", "10:00"), 5);
  });

  it("B) APODACA FIRMAS 08/09/10 ×5 → correcto", () => {
    const grid = [
      ["APODACA FIRMAS"],
      ...Array.from({ length: 5 }, () => ["08:00"]),
      ...Array.from({ length: 5 }, () => ["09:00"]),
      ...Array.from({ length: 5 }, () => ["10:00"]),
    ];
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-30",
      sheetTitle: "30 SEPTIEMBRE",
      sheetId: 2,
      grid,
    });
    assert.equal(countPhysical(rows, "apodaca", "08:00"), 5);
    assert.equal(countPhysical(rows, "apodaca", "09:00"), 5);
    assert.equal(countPhysical(rows, "apodaca", "10:00"), 5);
  });

  it("C+D) legacy MTY 08:30/09:30 y APO 10:30 siguen", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-16",
      sheetTitle: "16 SEPTIEMBRE",
      sheetId: 3,
      grid: [
        ["APODACA FIRMAS"],
        ["10:30"],
        ["10:30"],
        ["MONTERREY FIRMAS"],
        ["08:30"],
        ["09:30"],
        ["10:00"],
      ],
    });
    assert.equal(countPhysical(rows, "apodaca", "10:30"), 2);
    assert.equal(countPhysical(rows, "monterrey", "08:30"), 1);
    assert.equal(countPhysical(rows, "monterrey", "09:30"), 1);
    assert.equal(countPhysical(rows, "monterrey", "10:00"), 1);
  });

  it("E) duplicate MONTERREY FIRMAS legacy + appended targets", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-30",
      sheetTitle: "30 SEPTIEMBRE",
      sheetId: 99,
      grid: [
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
        ["MONTERREY FIRMAS"],
        ...Array.from({ length: 5 }, () => ["08:00"]),
        ...Array.from({ length: 2 }, () => ["09:00"]),
        ...Array.from({ length: 2 }, () => ["10:00"]),
      ],
    });
    assert.equal(countPhysical(rows, "monterrey", "08:00"), 5);
    assert.equal(countPhysical(rows, "monterrey", "09:00"), 5);
    assert.equal(countPhysical(rows, "monterrey", "10:00"), 5);
    assert.equal(countPhysical(rows, "monterrey", "08:30"), 1);
    assert.equal(countPhysical(rows, "monterrey", "09:30"), 1);
    const bio = rows.filter((r) => r.kind === "biometricos");
    assert.equal(bio.length, 1);
    assert.equal(bio[0]?.sheetRow, 11);
  });

  it("F) orphan APO 10:30 + nuevo APODACA FIRMAS header", () => {
    const { rows, issues } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-30",
      sheetTitle: "30 SEPTIEMBRE",
      sheetId: 4,
      grid: [
        [""],
        ["10:30"],
        ["10:30"],
        ["10:30"],
        ["MONTERREY FIRMAS"],
        ["08:30"],
        ["MONTERREY BIOMETRICOS"],
        ["08:00", "bio"],
        ["APODACA FIRMAS"],
        ...Array.from({ length: 5 }, () => ["08:00"]),
        ...Array.from({ length: 5 }, () => ["09:00"]),
        ...Array.from({ length: 5 }, () => ["10:00"]),
      ],
    });
    assert.equal(
      issues.filter((i) => i.code === "INVALID_OR_MISSING_SECTION_HEADER").length,
      0,
    );
    assert.equal(countPhysical(rows, "apodaca", "10:30"), 3);
    assert.equal(countPhysical(rows, "apodaca", "08:00"), 5);
    assert.equal(countPhysical(rows, "apodaca", "09:00"), 5);
    assert.equal(countPhysical(rows, "apodaca", "10:00"), 5);
  });

  it("G) slot_key duplicates=0 en layout piloto-like", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-30",
      sheetTitle: "30 SEPTIEMBRE",
      sheetId: 1641209889,
      grid: [
        [""],
        ["10:30"],
        ["10:30"],
        ["10:30"],
        ["MONTERREY FIRMAS"],
        ["08:30"],
        ["08:30"],
        ["08:30"],
        ["09:00"],
        ["09:00"],
        ["09:00"],
        ["09:30"],
        ["09:30"],
        ["09:30"],
        ["10:00"],
        ["10:00"],
        ["10:00"],
        ["MONTERREY BIOMETRICOS"],
        ["08:00", "bio"],
        ["APODACA BIOMETRICOS"],
        ["09:00", "bio"],
        ["MONTERREY FIRMAS"],
        ...Array.from({ length: 5 }, () => ["08:00"]),
        ...Array.from({ length: 2 }, () => ["09:00"]),
        ...Array.from({ length: 2 }, () => ["10:00"]),
        ["APODACA FIRMAS"],
        ...Array.from({ length: 5 }, () => ["08:00"]),
        ...Array.from({ length: 5 }, () => ["09:00"]),
        ...Array.from({ length: 5 }, () => ["10:00"]),
      ],
    });
    const keys = rows.map((r) => r.slotKey);
    assert.equal(keys.length, new Set(keys).size);
    assert.equal(countPhysical(rows, "monterrey", "08:00"), 5);
    assert.equal(countPhysical(rows, "apodaca", "08:00"), 5);
  });

  it("H) Biométricos fixture idéntico (alias 08:30→08:00 intacto)", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-05",
      sheetTitle: "05 AGOSTO",
      sheetId: 42,
      timeAliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
      grid: [
        ["MONTERREY BIOMETRICOS"],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "111", "Occ", "A"],
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.kind, "biometricos");
    assert.equal(rows[0]?.slotTime, "08:00");
    assert.equal(rows[0]?.sheetSlotTime, "08:30");
    assert.equal(rows[0]?.status, "available");
    assert.equal(rows[1]?.status, "occupied_external");
  });
});
