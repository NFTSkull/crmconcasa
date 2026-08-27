import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countAvailableByTime,
  effectiveSheetAwareRemaining,
  isInventoryEnforcedDate,
  parsePhysicalInventoryFromGrid,
} from "./sheet-inventory";
import { DEFAULT_BIOMETRICOS_0800_0830_ALIASES } from "./time-aliases";

describe("sheet-inventory", () => {
  it("enforcement desde 2026-07-30", () => {
    assert.equal(isInventoryEnforcedDate("2026-07-29"), false);
    assert.equal(isInventoryEnforcedDate("2026-07-30"), true);
    assert.equal(isInventoryEnforcedDate("2026-07-31"), true);
  });

  it("fila histórica ocupada sin O:U → occupied_external", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-07-31",
      sheetTitle: "31 JULIO",
      grid: [
        ["MONTERREY BIOMETRICOS"],
        ["8:00 AM", "03978108284", "ALGUIEN", "Asesor"],
        ["8:00 AM", "", "", ""],
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.status, "occupied_external");
    assert.equal(rows[1]?.status, "available");
    assert.equal(rows[0]?.techBookingId, null);
  });

  it("fila linked con P no se cuenta como available", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-07-31",
      sheetTitle: "31 JULIO",
      grid: [
        ["MONTERREY BIOMETRICOS"],
        [
          "10:00 AM",
          "03978108284",
          "GERARDO FUANTOS ZAVALA",
          "Luz Mejia",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "SINCRONIZADO",
          "db7997ca-2838-4f3d-8abb-1d515db8f394",
          "5611042a-0038-4ae2-b2ae-819bfc019dba",
          "biometricos|2026-07-31|10:00|monterrey|6",
        ],
        ["10:00 AM", "", "", ""],
      ],
    });
    assert.equal(rows[0]?.status, "linked");
    assert.equal(rows[1]?.status, "available");
    const avail = countAvailableByTime(rows, "biometricos", "monterrey");
    assert.equal(avail["10:00"], 1);
  });

  it("fila con O=CANCELADA cuenta available (no ocupa cupo)", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-03",
      sheetTitle: "03 AGOSTO ",
      grid: [
        ["MONTERREY BIOMETRICOS"],
        [
          "10:00 AM",
          "26148991321",
          "ELEAZAR SALMERON TERRAZAS",
          "Adriana Alcocer",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "CANCELADA",
          "99980405-15af-456a-9daa-fa71d8ab5a00",
          "4f1d5a3e-41b2-43a9-816c-6bcd3f2132b3",
          "k",
          "crm",
          "t",
          "2",
        ],
      ],
    });
    assert.equal(rows[0]?.status, "available");
    assert.equal(rows[0]?.techBookingId, null);
    assert.equal(
      countAvailableByTime(rows, "biometricos", "monterrey")["10:00"],
      1,
    );
  });

  it("NO HAY CITAS → disabled", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-07-30",
      sheetTitle: "30 JULIO",
      grid: [["APODACA BIOMETRICOS"], ["NO HAY CITAS"]],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.status, "disabled");
    assert.equal(rows[0]?.disabledReason, "NO_HAY_CITAS");
  });

  it("formatos de hora 8:00 AM / 8:00AM / 08:00", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-03",
      sheetTitle: "03 AGOSTO",
      grid: [
        ["MONTERREY BIOMETRICOS"],
        ["8:00 AM", "", ""],
        ["8:00AM", "", ""],
        ["08:00", "", ""],
      ],
    });
    assert.deepEqual(
      rows.map((r) => r.slotTime),
      ["08:00", "08:00", "08:00"],
    );
  });

  it("sección faltante (04 AGOSTO) → INVALID_OR_MISSING_SECTION_HEADER", () => {
    const { rows, issues } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-04",
      sheetTitle: "04 AGOSTO",
      grid: [
        [""], // A1 vacío
        // 07:00 no es plausible Firmas/Bio recovery → issue de encabezado
        ["7:00 AM", "", ""],
        ["MONTERREY BIOMETRICOS"],
        ["9:00 AM", "", ""],
      ],
    });
    assert.ok(issues.some((i) => i.code === "INVALID_OR_MISSING_SECTION_HEADER"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.slotTime, "09:00");
  });

  it("Gerardo: 08:00 lleno 6/6, 10:00 una libre luego linked", () => {
    const before = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-07-31",
      sheetTitle: "31 JULIO",
      grid: [
        ["MONTERREY BIOMETRICOS"],
        ...Array.from({ length: 6 }, () => ["8:00 AM", "123", "X", "Y"] as string[]),
        ...Array.from({ length: 5 }, () => ["10:00 AM", "123", "X", "Y"] as string[]),
        ["10:00 AM", "", "", ""],
      ],
    });
    const a08 = before.rows.filter((r) => r.slotTime === "08:00");
    const a10 = before.rows.filter((r) => r.slotTime === "10:00");
    assert.equal(a08.length, 6);
    assert.equal(a08.filter((r) => r.status === "available").length, 0);
    assert.equal(a10.filter((r) => r.status === "available").length, 1);

    const after = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-07-31",
      sheetTitle: "31 JULIO",
      grid: [
        ["MONTERREY BIOMETRICOS"],
        ...Array.from({ length: 6 }, () => ["8:00 AM", "123", "X", "Y"] as string[]),
        ...Array.from({ length: 5 }, () => ["10:00 AM", "123", "X", "Y"] as string[]),
        [
          "10:00 AM",
          "03978108284",
          "GERARDO FUANTOS ZAVALA",
          "Luz Mejia",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "SINCRONIZADO",
          "db7997ca-2838-4f3d-8abb-1d515db8f394",
        ],
      ],
    });
    assert.equal(
      after.rows.filter((r) => r.slotTime === "10:00" && r.status === "available").length,
      0,
    );
  });

  it("effective remaining respeta inventario y stale", () => {
    assert.deepEqual(
      effectiveSheetAwareRemaining({
        configRemaining: 4,
        inventoryAvailable: 1,
        inventoryFresh: true,
        inventoryEnforced: true,
      }),
      { remaining: 1, blockedReason: null },
    );
    assert.equal(
      effectiveSheetAwareRemaining({
        configRemaining: 4,
        inventoryAvailable: null,
        inventoryFresh: false,
        inventoryEnforced: true,
      }).remaining,
      0,
    );
    assert.equal(
      effectiveSheetAwareRemaining({
        configRemaining: 4,
        inventoryAvailable: 1,
        inventoryFresh: true,
        inventoryEnforced: false,
      }).remaining,
      4,
    );
  });

  it("alias bio: fila Sheet 08:30 → logical 08:00 y conserva sheetSlotTime", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-05",
      sheetTitle: "05 AGOSTO",
      timeAliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
      grid: [
        ["MONTERREY BIOMETRICOS"],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "03978108284", "Ocupado", "Asesor"],
        ["8:30 AM", "", "", ""],
        ["9:30 AM", "", "", ""],
        ["10:00 AM", "", "", ""],
      ],
    });
    const logical0800 = rows.filter((r) => r.slotTime === "08:00");
    assert.equal(logical0800.length, 3);
    assert.ok(logical0800.every((r) => r.sheetSlotTime === "08:30"));
    assert.equal(
      countAvailableByTime(rows, "biometricos", "monterrey")["08:00"],
      2,
    );
    assert.equal(
      countAvailableByTime(rows, "biometricos", "monterrey")["09:30"],
      1,
    );
    assert.equal(
      countAvailableByTime(rows, "biometricos", "monterrey")["10:00"],
      1,
    );
    assert.equal(
      countAvailableByTime(rows, "biometricos", "monterrey")["08:30"],
      undefined,
    );
    assert.ok(
      logical0800[0]?.slotKey.includes("sheet=08:30"),
      "slot_key debe incluir identidad física",
    );
    assert.ok(
      logical0800[0]?.slotKey.includes("sheetId="),
      "slot_key canónico incluye sheetId",
    );
    assert.ok(
      logical0800[0]?.slotKey.includes("row="),
      "slot_key canónico incluye row",
    );
  });

  it("alias bio apodaca 08:30→08:00; firmas 08:30 sin alias", () => {
    const bio = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-05",
      sheetTitle: "05 AGOSTO",
      timeAliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
      grid: [
        ["APODACA BIOMETRICOS"],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "", "", ""],
      ],
    });
    assert.equal(
      countAvailableByTime(bio.rows, "biometricos", "apodaca")["08:00"],
      2,
    );

    const firmas = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-05",
      sheetTitle: "05 AGOSTO",
      timeAliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
      grid: [
        ["MONTERREY FIRMAS"],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "", "", ""],
      ],
    });
    assert.equal(
      countAvailableByTime(firmas.rows, "firmas", "monterrey")["08:30"],
      2,
    );
    assert.equal(
      countAvailableByTime(firmas.rows, "firmas", "monterrey")["08:00"],
      undefined,
    );
  });

  it("caso 05 AGOSTO: 8 filas 08:30 vacías → 8 lugares lógicos 08:00", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-05",
      sheetTitle: "05 AGOSTO",
      sheetId: 90508,
      timeAliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
      grid: [
        ["MONTERREY BIOMETRICOS"],
        ...Array.from({ length: 8 }, () => ["8:30 AM", "", "", ""] as string[]),
        ...Array.from({ length: 8 }, () => ["10:00 AM", "", "", ""] as string[]),
      ],
    });
    assert.equal(
      countAvailableByTime(rows, "biometricos", "monterrey")["08:00"],
      8,
    );
    assert.equal(
      countAvailableByTime(rows, "biometricos", "monterrey")["10:00"],
      8,
    );
    const keys = new Set(rows.filter((r) => r.slotTime === "08:00").map((r) => r.slotKey));
    assert.equal(keys.size, 8);
  });

  it("reconcile/worker/webhook comparten el mismo physical key helper", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-05",
      sheetTitle: "05 AGOSTO",
      sheetId: 42,
      timeAliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
      grid: [["MONTERREY BIOMETRICOS"], ["8:30 AM", "", "", ""]],
    });
    assert.equal(
      rows[0]?.slotKey,
      "biometricos|2026-08-05|08:00|monterrey|sheet=08:30|sheetId=42|row=2",
    );
  });

  it("Firmas Monterrey: filas libres cuentan available", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-05",
      sheetTitle: "05 AGOSTO",
      grid: [
        ["MONTERREY FIRMAS"],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "", "", ""],
        ["9:00 AM", "", "", ""],
      ],
    });
    assert.equal(rows.every((r) => r.kind === "firmas"), true);
    assert.equal(rows.every((r) => r.locationId === "monterrey"), true);
    assert.equal(countAvailableByTime(rows, "firmas", "monterrey")["08:30"], 3);
    assert.equal(countAvailableByTime(rows, "firmas", "monterrey")["09:00"], 1);
  });

  it("Firmas Apodaca reconoce encabezado", () => {
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-05",
      sheetTitle: "05 AGOSTO",
      grid: [
        ["APODACA FIRMAS"],
        ["10:00 AM", "", "", ""],
        ["10:00 AM", "12345678901", "Cliente", "Asesor"],
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.locationId, "apodaca");
    assert.equal(rows[0]?.kind, "firmas");
    assert.equal(rows[0]?.status, "available");
    assert.equal(rows[1]?.status, "occupied_external");
  });

  it("04 AGOSTO: A1 vacío + 10:30 → Apodaca Firmas; Monterrey Firmas posterior intacto", () => {
    const { rows, issues } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-04",
      sheetTitle: "04 AGOSTO",
      grid: [
        [""], // A1 vacío / espacio
        ["10:30 AM", "x", "orphan", ""],
        ["10:30 AM", "", "", ""],
        ["MONTERREY FIRMAS"],
        ["8:30 AM", "111", "Occ1", "A"],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "", "", ""],
        ["9:00 AM", "222", "Occ2", "A"],
        ["9:00 AM", "", "", ""],
        ["9:00 AM", "", "", ""],
        ["9:30 AM", "", "", ""],
        ["9:30 AM", "", "", ""],
        ["9:30 AM", "", "", ""],
        ["10:00 AM", "", "", ""],
        ["10:00 AM", "", "", ""],
        ["10:00 AM", "", "", ""],
      ],
    });
    assert.equal(
      issues.filter((i) => i.code === "INVALID_OR_MISSING_SECTION_HEADER").length,
      0,
    );
    const apodaca = rows.filter((r) => r.kind === "firmas" && r.locationId === "apodaca");
    assert.equal(apodaca.length, 2);
    assert.equal(apodaca.every((r) => r.sectionHeaderMissing), true);
    assert.equal(countAvailableByTime(apodaca, "firmas", "apodaca")["10:30"], 1);
    const firmas = rows.filter((r) => r.kind === "firmas" && r.locationId === "monterrey");
    assert.equal(firmas.length, 12);
    assert.equal(countAvailableByTime(firmas, "firmas", "monterrey")["08:30"], 2);
    assert.equal(countAvailableByTime(firmas, "firmas", "monterrey")["09:00"], 2);
    assert.equal(countAvailableByTime(firmas, "firmas", "monterrey")["09:30"], 3);
    assert.equal(countAvailableByTime(firmas, "firmas", "monterrey")["10:00"], 3);
  });

  it("12 AGOSTO producción: A1 vacío + 3×10:30 → available 3 Apodaca (no Monterrey)", () => {
    const { rows, issues } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-12",
      sheetTitle: "12 AGOSTO",
      sheetId: 999,
      grid: [
        [""],
        ["HORA", "NSS", "NOMBRE", "ASESOR"],
        ["10:30 AM", "", "", ""],
        ["10:30 AM", "", "", ""],
        ["10:30 AM", "", "", ""],
        ["MONTERREY FIRMAS"],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "", "", ""],
        ["8:30 AM", "", "", ""],
      ],
    });
    assert.equal(
      issues.filter((i) => i.code === "INVALID_OR_MISSING_SECTION_HEADER").length,
      0,
    );
    const apo = rows.filter((r) => r.locationId === "apodaca" && r.kind === "firmas");
    assert.equal(apo.length, 3);
    assert.equal(countAvailableByTime(apo, "firmas", "apodaca")["10:30"], 3);
    assert.equal(
      rows.filter((r) => r.locationId === "monterrey" && r.slotTime === "10:30").length,
      0,
    );
  });

  it("1 manual Apodaca → available 2; 3 manuales → 0", () => {
    const one = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-13",
      sheetTitle: "13 AGOSTO",
      grid: [
        [""],
        ["10:30 AM", "11111111111", "Cliente", "Asesor"],
        ["10:30 AM", "", "", ""],
        ["10:30 AM", "", "", ""],
        ["MONTERREY FIRMAS"],
        ["8:30 AM", "", "", ""],
      ],
    });
    assert.equal(countAvailableByTime(one.rows, "firmas", "apodaca")["10:30"], 2);

    const full = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-13",
      sheetTitle: "13 AGOSTO",
      grid: [
        ["APODACA FIRMAS"],
        ["10:30 AM", "1", "A", "X"],
        ["10:30 AM", "2", "B", "Y"],
        ["10:30 AM", "3", "C", "Z"],
      ],
    });
    assert.equal(countAvailableByTime(full.rows, "firmas", "apodaca")["10:30"] ?? 0, 0);
  });

  it("no confunde 08:30 huérfano con Apodaca (recupera Monterrey Firmas ante Bio)", () => {
    const { rows, issues } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-04",
      sheetTitle: "04 AGOSTO",
      grid: [
        [""],
        ["8:30 AM", "", "", ""],
        ["MONTERREY BIOMETRICOS"],
        ["9:00 AM", "", "", ""],
      ],
    });
    assert.equal(rows.filter((r) => r.locationId === "apodaca").length, 0);
    assert.equal(
      rows.filter((r) => r.locationId === "monterrey" && r.kind === "firmas" && r.slotTime === "08:30")
        .length,
      1,
    );
    assert.equal(
      rows.filter((r) => r.kind === "biometricos" && r.slotTime === "09:00").length,
      1,
    );
    assert.equal(
      issues.filter((i) => i.code === "INVALID_OR_MISSING_SECTION_HEADER").length,
      0,
    );
  });

  it("hora desconocida huérfana sigue en INVALID", () => {
    const { rows, issues } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-04",
      sheetTitle: "04 AGOSTO",
      grid: [
        [""],
        ["7:15 AM", "", "", ""],
        ["MONTERREY BIOMETRICOS"],
        ["9:00 AM", "", "", ""],
      ],
    });
    assert.ok(issues.some((i) => i.code === "INVALID_OR_MISSING_SECTION_HEADER"));
    assert.equal(rows.filter((r) => r.slotTime === "07:15").length, 0);
  });

  it("hints por sheet_row rehidratan Apodaca sin header ni next", () => {
    const hints = new Map([
      [3, { sede: "apodaca" as const, kind: "firmas" as const }],
      [4, { sede: "apodaca" as const, kind: "firmas" as const }],
      [5, { sede: "apodaca" as const, kind: "firmas" as const }],
    ]);
    const { rows } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-14",
      sheetTitle: "14 AGOSTO",
      sectionHints: hints,
      grid: [
        [""],
        [""],
        ["10:30 AM", "", "", ""],
        ["10:30 AM", "", "", ""],
        ["10:30 AM", "", "", ""],
      ],
    });
    assert.equal(rows.length, 3);
    assert.equal(countAvailableByTime(rows, "firmas", "apodaca")["10:30"], 3);
  });

  it("07 AGOSTO filas 9–20: tres 09:30 y tres 10:00 vacías = capacidad 3 c/u (slot_key por row)", () => {
    // Encabezado fila 8; horas sheet 9–20 (como en CITAS 2026 / 07 AGOSTO).
    const { rows: aligned } = parsePhysicalInventoryFromGrid({
      bookingDate: "2026-08-07",
      sheetTitle: "07 AGOSTO",
      sheetId: 195044516,
      grid: [
        ...Array.from({ length: 7 }, () => [""] as string[]),
        ["MONTERREY FIRMAS"], // sheet row 8
        ["8:30 AM", "11111111111", "OccA", "Asesor"], // 9
        ["8:30 AM", "22222222222", "OccB", "Asesor"], // 10
        ["8:30 AM", "33333333333", "OccC", "Asesor"], // 11
        ["9:00 AM", "44444444444", "OccD", "Asesor"], // 12
        ["9:00 AM", "55555555555", "OccE", "Asesor"], // 13
        ["9:00 AM", "", "", ""], // 14
        ["9:30 AM", "", "", ""], // 15
        ["9:30 AM", "", "", ""], // 16
        ["9:30 AM", "", "", ""], // 17
        ["10:00 AM", "", "", ""], // 18
        ["10:00 AM", "", "", ""], // 19
        ["10:00 AM", "", "", ""], // 20
      ],
    });
    const firmas = aligned.filter(
      (r) => r.kind === "firmas" && r.locationId === "monterrey",
    );
    assert.equal(firmas.length, 12);
    const avail = countAvailableByTime(firmas, "firmas", "monterrey");
    assert.equal(avail["08:30"] ?? 0, 0);
    assert.equal(avail["09:00"] ?? 0, 1);
    assert.equal(avail["09:30"] ?? 0, 3);
    assert.equal(avail["10:00"] ?? 0, 3);
    assert.equal(firmas.filter((r) => r.sheetSlotTime === "08:30").length, 3);
    assert.equal(
      firmas.filter((r) => r.sheetSlotTime === "08:30" && r.status === "occupied_external")
        .length,
      3,
    );
    const keys930 = firmas
      .filter((r) => r.sheetSlotTime === "09:30")
      .map((r) => r.slotKey);
    assert.equal(keys930.length, 3);
    assert.equal(new Set(keys930).size, 3);
    assert.deepEqual(
      firmas.filter((r) => r.sheetSlotTime === "09:30").map((r) => r.sheetRow),
      [15, 16, 17],
    );
    assert.deepEqual(
      firmas.filter((r) => r.sheetSlotTime === "10:00").map((r) => r.sheetRow),
      [18, 19, 20],
    );
    assert.ok(keys930.every((k) => k.includes("|sheet=09:30|")));
    assert.ok(keys930.every((k) => k.includes("sheetId=195044516")));
  });
});
