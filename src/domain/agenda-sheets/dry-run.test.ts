import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgendaSheetsDryRunReport } from "./dry-run";
import {
  AGENDA_SHEET_PRESERVE_RANGE,
  AGENDA_SHEET_TECH_RANGE,
} from "./tech-columns";

describe("agenda-sheets dry-run", () => {
  it("detecta pestaña no reconocida y NSS inválido sin escribir", () => {
    const report = buildAgendaSheetsDryRunReport({
      year: 2026,
      tabs: [
        { title: "FOO", sheetId: 1, rows: [] },
        {
          title: "29 JULIO",
          sheetId: 1288978311,
          rows: [
            ["MONTERREY BIOMETRICOS"],
            ["HORA", "NSS", "NOMBRE", "ASESOR"],
            ["8:30 AM", "´03179461821", "A", "B"],
            ["8:30 AM", "123", "X", "Y"],
          ],
        },
      ],
      crmBookings: [
        {
          id: "b1",
          kind: "biometricos",
          bookingDate: "2026-07-29",
          bookingTime: "08:30:00",
          locationId: "monterrey",
          nss: "03179461821",
          status: "booked",
        },
      ],
    });
    assert.deepEqual(report.tabsUnrecognized, ["FOO"]);
    assert.equal(report.invalidNss.length, 1);
    assert.equal(report.bothOccupied.length, 1);
    assert.equal(report.slots.length, 2);
    assert.equal(report.tabsAborted.length, 0);
    assert.equal(report.columnAudits[0]?.preservePolicy, "PRESERVAR");
    assert.equal(report.columnAudits[0]?.techRange, AGENDA_SHEET_TECH_RANGE);
    assert.equal(report.columnAudits[0]?.preserveRange, AGENDA_SHEET_PRESERVE_RANGE);
  });

  it("aborta pestaña si O:U tiene datos inesperados; H:N no bloquea", () => {
    const rowHi = Array(21).fill("");
    rowHi[0] = "8:30 AM";
    rowHi[7] = "fecha real"; // H PRESERVAR
    rowHi[8] = "nota"; // I PRESERVAR

    const rowOuDirty = Array(21).fill("");
    rowOuDirty[0] = "9:00 AM";
    rowOuDirty[14] = "basura"; // O

    const report = buildAgendaSheetsDryRunReport({
      year: 2026,
      tabs: [
        {
          title: "30 JULIO",
          sheetId: 2,
          rows: [
            ["MONTERREY BIOMETRICOS"],
            ["HORA", "NSS", "NOMBRE", "ASESOR"],
            rowHi,
          ],
        },
        {
          title: "31 JULIO",
          sheetId: 3,
          rows: [
            ["MONTERREY BIOMETRICOS"],
            ["HORA", "NSS", "NOMBRE", "ASESOR"],
            rowOuDirty,
          ],
        },
      ],
      crmBookings: [],
    });
    assert.deepEqual(report.tabsAborted, ["31 JULIO"]);
    assert.equal(report.columnAudits.find((c) => c.tab === "30 JULIO")?.aborted, false);
    assert.equal(report.columnAudits.find((c) => c.tab === "31 JULIO")?.aborted, true);
    // 30 JULIO enumeró el slot; 31 abortó sin slots de esa pestaña
    assert.equal(report.slots.every((s) => s.slotTime === "08:30"), true);
  });
});
