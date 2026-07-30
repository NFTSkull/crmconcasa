import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
  buildLogicalBookingKey,
  buildPhysicalSheetRowKey,
  normalizeHhMm,
  parsePhysicalSheetRowKey,
  resolveLogicalStartTime,
  resolveSheetStartTime,
} from "./time-aliases";

describe("time-aliases", () => {
  it("normaliza HH:mm / HH:mm:ss", () => {
    assert.equal(normalizeHhMm("8:30"), "08:30");
    assert.equal(normalizeHhMm("08:30:00"), "08:30");
    assert.equal(normalizeHhMm("bad"), null);
  });

  it("monterrey biometricos: sheet 08:30 → logical 08:00", () => {
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "08:30",
      }),
      "08:00",
    );
    assert.equal(
      resolveSheetStartTime({
        aliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        logicalStartTime: "08:00",
      }),
      "08:30",
    );
  });

  it("apodaca biometricos: mismo alias 08:00⇄08:30", () => {
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
        locationId: "apodaca",
        kind: "biometricos",
        sheetStartTime: "08:30",
      }),
      "08:00",
    );
  });

  it("firmas / 10:00 / 09:30 no alias", () => {
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
        locationId: "monterrey",
        kind: "firmas",
        sheetStartTime: "08:30",
      }),
      "08:30",
    );
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "10:00",
      }),
      "10:00",
    );
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_0800_0830_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "09:30",
      }),
      "09:30",
    );
  });

  it("alias desactivado deja de aplicar", () => {
    const off = DEFAULT_BIOMETRICOS_0800_0830_ALIASES.map((a) => ({
      ...a,
      active: false,
    }));
    assert.equal(
      resolveLogicalStartTime({
        aliases: off,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "08:30",
      }),
      "08:30",
    );
  });

  it("logical booking key sin identidad física", () => {
    assert.equal(
      buildLogicalBookingKey({
        kind: "biometricos",
        bookingDate: "2026-08-05",
        logicalStartTime: "08:00",
        locationId: "monterrey",
      }),
      "biometricos|2026-08-05|08:00|monterrey",
    );
  });

  it("physical sheet row key canónica incluye sheet/sheetId/row", () => {
    const k = buildPhysicalSheetRowKey({
      kind: "biometricos",
      bookingDate: "2026-08-05",
      logicalStartTime: "08:00",
      sheetStartTime: "08:30",
      locationId: "monterrey",
      sheetId: 90508,
      rowNumber: 12,
    });
    assert.equal(
      k,
      "biometricos|2026-08-05|08:00|monterrey|sheet=08:30|sheetId=90508|row=12",
    );
    const parsed = parsePhysicalSheetRowKey(k);
    assert.equal(parsed?.format, "canonical");
    assert.equal(parsed?.sheetStartTime, "08:30");
    assert.equal(parsed?.rowNumber, 12);
  });

  it("dos filas 08:30 tienen identidades físicas distintas por row", () => {
    const a = buildPhysicalSheetRowKey({
      kind: "biometricos",
      bookingDate: "2026-08-05",
      logicalStartTime: "08:00",
      sheetStartTime: "08:30",
      locationId: "monterrey",
      sheetId: 1,
      rowNumber: 10,
    });
    const b = buildPhysicalSheetRowKey({
      kind: "biometricos",
      bookingDate: "2026-08-05",
      logicalStartTime: "08:00",
      sheetStartTime: "08:30",
      locationId: "monterrey",
      sheetId: 1,
      rowNumber: 11,
    });
    assert.notEqual(a, b);
    assert.equal(
      buildLogicalBookingKey({
        kind: "biometricos",
        bookingDate: "2026-08-05",
        logicalStartTime: "08:00",
        locationId: "monterrey",
      }),
      "biometricos|2026-08-05|08:00|monterrey",
    );
  });

  it("parse lee keys legacy ordinal sin reescribir", () => {
    const legacy = parsePhysicalSheetRowKey(
      "biometricos|2026-07-31|10:00|monterrey|6",
    );
    assert.equal(legacy?.format, "legacy_ordinal");
    assert.equal(legacy?.logicalStartTime, "10:00");
    assert.equal(legacy?.sheetStartTime, "10:00");
    assert.equal(legacy?.rowNumber, 6);
    const legacyAlias = parsePhysicalSheetRowKey(
      "biometricos|2026-08-05|08:00|monterrey|2|sheet=08:30",
    );
    assert.equal(legacyAlias?.sheetStartTime, "08:30");
    assert.equal(legacyAlias?.format, "legacy_ordinal");
  });

  it("logical key ≠ physical key (sin colisión de formato)", () => {
    const logical = buildLogicalBookingKey({
      kind: "biometricos",
      bookingDate: "2026-08-05",
      logicalStartTime: "08:00",
      locationId: "monterrey",
    });
    const physical = buildPhysicalSheetRowKey({
      kind: "biometricos",
      bookingDate: "2026-08-05",
      logicalStartTime: "08:00",
      sheetStartTime: "08:30",
      locationId: "monterrey",
      sheetId: 1,
      rowNumber: 10,
    });
    assert.notEqual(logical, physical);
    assert.ok(physical.startsWith(logical + "|"));
  });
});
