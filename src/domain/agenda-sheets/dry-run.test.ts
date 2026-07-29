import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAgendaSheetsDryRunReport } from "./dry-run";

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
  });
});
