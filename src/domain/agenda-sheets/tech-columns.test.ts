import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENDA_SHEET_COL_1BASED,
  AGENDA_SHEET_COL_INDEX,
  AGENDA_SHEET_PRESERVE_RANGE,
  AGENDA_SHEET_TECH_COLUMNS,
  AGENDA_SHEET_TECH_RANGE,
  a1TechRange,
  assertTechColumnsWritable,
  buildTechWriteRow,
  isPreserveOnlyColumn1Based,
  isTechColumn1Based,
  tabHasUnexpectedTechData,
} from "./tech-columns";

describe("agenda-sheets tech columns O:U", () => {
  it("contrato O:U (no H:N)", () => {
    assert.equal(AGENDA_SHEET_TECH_RANGE, "O:U");
    assert.equal(AGENDA_SHEET_PRESERVE_RANGE, "A:N");
    assert.equal(AGENDA_SHEET_TECH_COLUMNS.estado, "O");
    assert.equal(AGENDA_SHEET_TECH_COLUMNS.bookingId, "P");
    assert.equal(AGENDA_SHEET_TECH_COLUMNS.syncVersion, "U");
    assert.equal(AGENDA_SHEET_COL_INDEX.bookingId, 15);
    assert.equal(AGENDA_SHEET_COL_1BASED.bookingId, 16);
  });

  it("H:N son preserve-only; O:U son técnicas", () => {
    assert.equal(isPreserveOnlyColumn1Based(8), true); // H
    assert.equal(isPreserveOnlyColumn1Based(14), true); // N
    assert.equal(isPreserveOnlyColumn1Based(15), false); // O
    assert.equal(isTechColumn1Based(15), true);
    assert.equal(isTechColumn1Based(21), true);
    assert.equal(isTechColumn1Based(14), false);
  });

  it("a1 tech range usa O:U", () => {
    assert.equal(a1TechRange("29 JULIO", 12), "'29 JULIO'!O12:U12");
  });

  it("O:U vacío permite write", () => {
    const d = assertTechColumnsWritable({
      existingRowOrTech: ["", "", "", "", "", "", ""],
      bookingId: "b1",
    });
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.mode, "write");
  });

  it("mismo booking en P → idempotent", () => {
    const d = assertTechColumnsWritable({
      existingRowOrTech: ["SINCRONIZADO", "b1", "e1", "k", "crm", "t", "1"],
      bookingId: "b1",
    });
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.mode, "idempotent");
  });

  it("otro booking en P → conflicto", () => {
    const d = assertTechColumnsWritable({
      existingRowOrTech: ["SINCRONIZADO", "other", "e1", "k", "crm", "t", "1"],
      bookingId: "b1",
    });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.reason, "other_booking");
  });

  it("datos inesperados en O:U sin P → bloqueo", () => {
    const d = assertTechColumnsWritable({
      existingRowOrTech: ["NOTA RARA", "", "", "", "", "", ""],
      bookingId: "b1",
    });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.reason, "unexpected_data");
  });

  it("buildTechWriteRow orden O:U", () => {
    assert.deepEqual(
      buildTechWriteRow({
        estado: "SINCRONIZADO",
        bookingId: "b1",
        expedienteId: "e1",
        slotKey: "biometricos|2026-07-29|08:30|monterrey|1",
        syncSource: "crm",
        syncUpdatedAt: "t",
        syncVersion: 2,
      }),
      [
        "SINCRONIZADO",
        "b1",
        "e1",
        "biometricos|2026-07-29|08:30|monterrey|1",
        "crm",
        "t",
        "2",
      ],
    );
  });

  it("tab con basura en O:U se marca blocked", () => {
    const row = Array(21).fill("");
    row[14] = "papeleria"; // O
    const r = tabHasUnexpectedTechData([row]);
    assert.equal(r.blocked, true);
    assert.equal(r.samples[0]?.col, "O");
  });

  it("fila H:I con datos no afecta tech scan si O:U vacío", () => {
    const row = Array(21).fill("");
    row[7] = "2026-07-30"; // H
    row[8] = "nota papeleria"; // I
    const r = tabHasUnexpectedTechData([row]);
    assert.equal(r.blocked, false);
  });
});
