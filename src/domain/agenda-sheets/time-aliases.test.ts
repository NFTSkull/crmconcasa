import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BIOMETRICOS_TIME_ALIASES,
  buildLogicalBookingKey,
  buildPhysicalSheetRowKey,
  normalizeHhMm,
  parsePhysicalSheetRowKey,
  resolveLogicalStartTime,
  resolvePhysicalSheetTimes,
  resolveSheetStartTime,
  sortInventoryCandidatesForLogicalBooking,
} from "./time-aliases";

describe("time-aliases many-to-one", () => {
  it("normaliza HH:mm / HH:mm:ss", () => {
    assert.equal(normalizeHhMm("8:30"), "08:30");
    assert.equal(normalizeHhMm("08:30:00"), "08:30");
    assert.equal(normalizeHhMm("bad"), null);
  });

  it("08:30 físico → 08:00 lógico; pool 08:00 = [08:30]", () => {
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "08:30",
      }),
      "08:00",
    );
    assert.deepEqual(
      resolvePhysicalSheetTimes({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        logicalStartTime: "08:00",
      }),
      ["08:30"],
    );
  });

  it("10:00 lógico acepta físicos 10:00 y 11:00", () => {
    assert.deepEqual(
      resolvePhysicalSheetTimes({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        logicalStartTime: "10:00",
      }),
      ["10:00", "11:00"],
    );
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "10:00",
      }),
      "10:00",
    );
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "11:00",
      }),
      "10:00",
    );
  });

  it("11:00 no es lógico independiente dentro del pool", () => {
    assert.equal(
      resolveSheetStartTime({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        logicalStartTime: "11:00",
      }),
      "11:00", // identidad: no hay logical 11:00 en defaults
    );
    // físico 11:00 no mapea a logical 11:00
    assert.notEqual(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "11:00",
      }),
      "11:00",
    );
  });

  it("preferencia determinista: 10:00 antes que 11:00, luego row", () => {
    const sorted = sortInventoryCandidatesForLogicalBooking([
      { sheetStartTime: "11:00", rowNumber: 34 },
      { sheetStartTime: "10:00", rowNumber: 33 },
      { sheetStartTime: "11:00", rowNumber: 35 },
    ]);
    assert.deepEqual(
      sorted.map((r) => `${r.sheetStartTime}:${r.rowNumber}`),
      ["10:00:33", "11:00:34", "11:00:35"],
    );
  });

  it("apodaca hereda mismos pools biométricos", () => {
    assert.deepEqual(
      resolvePhysicalSheetTimes({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "apodaca",
        kind: "biometricos",
        logicalStartTime: "10:00",
      }),
      ["10:00", "11:00"],
    );
  });

  it("firmas / 09:30 sin alias de pool", () => {
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "monterrey",
        kind: "firmas",
        sheetStartTime: "08:30",
      }),
      "08:30",
    );
    assert.equal(
      resolveLogicalStartTime({
        aliases: DEFAULT_BIOMETRICOS_TIME_ALIASES,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "09:30",
      }),
      "09:30",
    );
  });

  it("physical keys distintas para 10:00 y 11:00 bajo mismo logical", () => {
    const a = buildPhysicalSheetRowKey({
      kind: "biometricos",
      bookingDate: "2026-08-06",
      logicalStartTime: "10:00",
      sheetStartTime: "10:00",
      locationId: "monterrey",
      sheetId: 279670655,
      rowNumber: 33,
    });
    const b = buildPhysicalSheetRowKey({
      kind: "biometricos",
      bookingDate: "2026-08-06",
      logicalStartTime: "10:00",
      sheetStartTime: "11:00",
      locationId: "monterrey",
      sheetId: 279670655,
      rowNumber: 34,
    });
    assert.equal(
      a,
      "biometricos|2026-08-06|10:00|monterrey|sheet=10:00|sheetId=279670655|row=33",
    );
    assert.equal(
      b,
      "biometricos|2026-08-06|10:00|monterrey|sheet=11:00|sheetId=279670655|row=34",
    );
    assert.notEqual(a, b);
    assert.equal(
      buildLogicalBookingKey({
        kind: "biometricos",
        bookingDate: "2026-08-06",
        logicalStartTime: "10:00",
        locationId: "monterrey",
      }),
      "biometricos|2026-08-06|10:00|monterrey",
    );
  });

  it("parse lee keys legacy ordinal sin reescribir", () => {
    const legacy = parsePhysicalSheetRowKey(
      "biometricos|2026-07-31|10:00|monterrey|6",
    );
    assert.equal(legacy?.format, "legacy_ordinal");
    assert.equal(legacy?.logicalStartTime, "10:00");
  });

  it("override inactivo no aplica (identidad)", () => {
    const off = DEFAULT_BIOMETRICOS_TIME_ALIASES.map((a) => ({
      ...a,
      active: false,
    }));
    assert.equal(
      resolveLogicalStartTime({
        aliases: off,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "11:00",
      }),
      "11:00",
    );
  });
});
