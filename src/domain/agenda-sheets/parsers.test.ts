import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  crmSlotKey,
  enumerateSheetSlots,
  isSheetBlockTerminator,
  normalizeSheetNss,
  parseSheetSectionHeader,
  parseSheetTabDate,
  parseSheetTime,
  parseYearFromSpreadsheetTitle,
  sheetLocalDateTimeToIso,
} from "./parsers";

describe("agenda-sheets parsers: pestañas y año", () => {
  it("parsea CITAS 2026", () => {
    const y = parseYearFromSpreadsheetTitle("CITAS 2026");
    assert.equal(y.ok, true);
    if (!y.ok) return;
    assert.equal(y.value, 2026);
  });

  it("29 JULIO → 2026-07-29", () => {
    const r = parseSheetTabDate("29 JULIO", 2026);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "2026-07-29");
  });

  it("03 AGOSTO con espacios finales", () => {
    const r = parseSheetTabDate("03 AGOSTO ", 2026);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "2026-08-03");
  });

  it("espacios iniciales/finales en pestaña", () => {
    const r = parseSheetTabDate("  3 julio  ", 2026);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "2026-07-03");
  });

  it("mes inválido", () => {
    const r = parseSheetTabDate("29 XYZ", 2026);
    assert.equal(r.ok, false);
  });
});

describe("agenda-sheets parsers: horas", () => {
  it("8:30AM", () => {
    const r = parseSheetTime("8:30AM");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "08:30");
  });
  it("8:30 AM", () => {
    const r = parseSheetTime("8:30 AM");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "08:30");
  });
  it("8:30", () => {
    const r = parseSheetTime("8:30");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "08:30");
  });
  it("10:00 AM", () => {
    const r = parseSheetTime("10:00 AM");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "10:00");
  });
  it("9:30AM", () => {
    const r = parseSheetTime("9:30AM");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "09:30");
  });
  it("11:00", () => {
    const r = parseSheetTime("11:00");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "11:00");
  });
  it("hora inválida", () => {
    assert.equal(parseSheetTime("mediodía").ok, false);
    assert.equal(parseSheetTime("25:00").ok, false);
    assert.equal(parseSheetTime("10:99 AM").ok, false);
  });
});

describe("agenda-sheets parsers: secciones y terminadores", () => {
  it("MONTERREY FIRMAS", () => {
    const r = parseSheetSectionHeader("MONTERREY FIRMAS");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value.sede, "monterrey");
      assert.equal(r.value.kind, "firmas");
    }
  });
  it("Monterrey Biométricos (acentos)", () => {
    const r = parseSheetSectionHeader("Monterrey Biométricos");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.kind, "biometricos");
  });
  it("APODACA FIRMAS", () => {
    const r = parseSheetSectionHeader("APODACA FIRMAS");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.sede, "apodaca");
  });
  it("APODACA BIOMETRICOS", () => {
    const r = parseSheetSectionHeader("APODACA BIOMETRICOS");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.kind, "biometricos");
  });
  it("CITAS CANCELADAS termina bloque", () => {
    assert.equal(isSheetBlockTerminator("CITAS CANCELADAS"), true);
  });
  it("NO HAY CITAS termina bloque", () => {
    assert.equal(isSheetBlockTerminator("NO HAY CITAS"), true);
  });
});

describe("agenda-sheets parsers: NSS y ordinales", () => {
  it("NSS con apóstrofe tipográfico", () => {
    const r = normalizeSheetNss("´03179461821");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "03179461821");
  });
  it("NSS con cero inicial y guiones", () => {
    const r = normalizeSheetNss("031-794-61821");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, "03179461821");
  });
  it("NSS inválido", () => {
    assert.equal(normalizeSheetNss("123").ok, false);
    assert.equal(normalizeSheetNss("abcdefghijk").ok, false);
  });
  it("horas repetidas con distinto ordinal", () => {
    const slots = enumerateSheetSlots({
      sheetDate: "2026-07-29",
      startRowNumber: 10,
      rows: [
        ["MONTERREY BIOMETRICOS"],
        ["HORA", "NSS", "NOMBRE", "ASESOR"],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "", "", ""],
        ["CITAS CANCELADAS"],
        ["9:00 AM", "x", "", ""],
      ],
    });
    assert.equal(slots.length, 3);
    assert.deepEqual(
      slots.map((s) => s.slotOrdinal),
      [1, 2, 3],
    );
    assert.equal(slots[0]?.slotTime, "08:30");
    assert.equal(slots[0]?.rowNumber, 12);
    assert.equal(slots[2]?.rowNumber, 14);
  });
  it("crmSlotKey no incluye ordinal (capacidad CRM)", () => {
    assert.equal(
      crmSlotKey({
        kind: "biometricos",
        date: "2026-07-29",
        time: "08:30",
        locationId: "monterrey",
      }),
      "biometricos|2026-07-29|08:30|monterrey",
    );
  });
  it("sheetLocalDateTimeToIso no cambia el día vía UTC", () => {
    const r = sheetLocalDateTimeToIso("2026-07-29", "08:30");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.value, "2026-07-29T08:30:00-06:00");
      assert.ok(r.value.startsWith("2026-07-29"));
    }
  });
});
