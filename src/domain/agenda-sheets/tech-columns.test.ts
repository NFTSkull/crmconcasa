import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENDA_SHEET_COL_1BASED,
  AGENDA_SHEET_COL_INDEX,
  AGENDA_SHEET_PRESERVE_RANGE,
  AGENDA_SHEET_TECH_COLUMNS,
  AGENDA_SHEET_TECH_RANGE,
  TECH_SOURCE_EXPLICIT_OU,
  a1TechRange,
  assertTechColumnsWritable,
  buildTechWriteRow,
  extractTechCells,
  isPreserveOnlyColumn1Based,
  isTechColumn1Based,
  tabHasUnexpectedTechData,
  techCellsAreEmpty,
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

  it("1) fila A:G con siete valores no es O:U", () => {
    const ag = ["HORA", "NSS", "NOMBRE", "ASESOR", "NOTIFICACION", "FIRMO", "FIRMA"];
    assert.equal(ag.length, 7);
    const tech = extractTechCells(ag); // absolute from A
    assert.equal(techCellsAreEmpty(tech), true);
    assert.equal(tabHasUnexpectedTechData([ag]).blocked, false);
  });

  it("2) fila H:N con siete valores (startColumn=7) no es O:U", () => {
    const hn = ["h", "i", "j", "k", "l", "m", "n"];
    const tech = extractTechCells(hn, {
      kind: "absolute_row",
      startColumnIndex: 7,
    });
    assert.equal(techCellsAreEmpty(tech), true);
  });

  it("3) fila O:U explícita con siete valores sí es técnica", () => {
    const ou = ["SINCRONIZADO", "b1", "e1", "k", "crm", "t", "1"];
    const tech = extractTechCells(ou, TECH_SOURCE_EXPLICIT_OU);
    assert.deepEqual(tech, ou);
  });

  it("4) fila A:U completa lee índices 14-20", () => {
    const row = Array(21).fill("");
    row[0] = "8:30 AM";
    row[14] = "ESTADO";
    row[15] = "b1";
    const tech = extractTechCells(row);
    assert.equal(tech[0], "ESTADO");
    assert.equal(tech[1], "b1");
  });

  it("5) sparse solo P (col 15)", () => {
    const row = Array(16).fill("");
    row[15] = "booking-p";
    const tech = extractTechCells(row);
    assert.equal(tech[1], "booking-p");
    assert.equal(String(tech[0]).trim(), "");
  });

  it("6) sparse solo U (col 20)", () => {
    const row = Array(21).fill("");
    row[20] = "9";
    const tech = extractTechCells(row);
    assert.equal(tech[6], "9");
  });

  it("7) O:U vacías permiten write", () => {
    const d = assertTechColumnsWritable({
      existingRowOrTech: Array(21).fill(""),
      bookingId: "b1",
    });
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.mode, "write");
  });

  it("8) O:U con booking diferente → conflicto", () => {
    const d = assertTechColumnsWritable({
      existingRowOrTech: ["SINCRONIZADO", "other", "e1", "k", "crm", "t", "1"],
      bookingId: "b1",
      source: TECH_SOURCE_EXPLICIT_OU,
    });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.reason, "other_booking");
  });

  it("9) O:U con el mismo booking → idempotent", () => {
    const d = assertTechColumnsWritable({
      existingRowOrTech: ["SINCRONIZADO", "b1", "e1", "k", "crm", "t", "1"],
      bookingId: "b1",
      source: TECH_SOURCE_EXPLICIT_OU,
    });
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.mode, "idempotent");
  });

  it("10) información inesperada en O:U sin P → bloqueo", () => {
    const d = assertTechColumnsWritable({
      existingRowOrTech: ["NOTA RARA", "", "", "", "", "", ""],
      bookingId: "b1",
      source: TECH_SOURCE_EXPLICIT_OU,
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
