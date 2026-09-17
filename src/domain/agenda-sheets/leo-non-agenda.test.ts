import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePhysicalInventoryFromGrid } from "./sheet-inventory";

describe("LEO / HACER PAGARES fuera de agenda", () => {
  it("no cuenta filas LEO como biométricos y reanuda en el siguiente bloque real", () => {
    const { rows, issues } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-09-18",
      sheetTitle: "18 SEPTIEMBRE",
      sheetId: 282331198,
      grid: [
        ["MONTERREY BIOMETRICOS"],
        ["8:30 AM", "111", "PERSONA MTY", "ASESOR MTY"],
        ["LEO", "", "", "HACER PAGARES"],
        ["8:00 AM", "222", "BENITO", "ANETTE"],
        ["8:00 AM", "333", "MARTIN", "ANETTE"],
        [""],
        ["APODACA BIOMETRICOS"],
        ["8:30 AM", "444", "PERSONA APO", "ASESOR APO"],
      ],
    });

    assert.deepEqual(
      rows.map((row) => ({
        sheetRow: row.sheetRow,
        kind: row.kind,
        locationId: row.locationId,
        visibleNss: row.visibleNss,
      })),
      [
        {
          sheetRow: 2,
          kind: "biometricos",
          locationId: "monterrey",
          visibleNss: "111",
        },
        {
          sheetRow: 8,
          kind: "biometricos",
          locationId: "apodaca",
          visibleNss: "444",
        },
      ],
    );

    assert.equal(rows.some((row) => row.visibleNss === "222"), false);
    assert.equal(rows.some((row) => row.visibleNss === "333"), false);
    assert.equal(issues.length, 0);
  });
});
