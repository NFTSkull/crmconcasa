import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyAgendaBiometricosWeeklyConfig,
  mapSqlConfigToWeeklyUi,
  mapWeeklyUiToSqlCanonical,
  slugifyAgendaLocationId,
} from "./map-agenda-config";

describe("mapSqlConfigToWeeklyUi", () => {
  it("mapea JSON canónico SQL a modelo semanal UI", () => {
    const ui = mapSqlConfigToWeeklyUi({
      enabled: true,
      timezone: "America/Monterrey",
      min_lead_hours: 48,
      allowed_weekdays: [1, 3, 5],
      slots: ["09:00", "10:30"],
      locations: {
        "mty-centro": {
          enabled: true,
          capacity_per_slot: 3,
          label: "Centro",
        },
        "san-nicolas": { enabled: false, capacity_per_slot: 2 },
      },
    });

    assert.equal(ui.enabled, true);
    assert.equal(ui.timezone, "America/Monterrey");
    assert.equal(ui.minLeadHours, 48);
    assert.deepEqual(ui.allowedWeekdays, [1, 3, 5]);
    assert.deepEqual(ui.slots, ["09:00", "10:30"]);
    assert.equal(ui.locations.length, 2);
    assert.equal(ui.locations[0]?.id, "mty-centro");
    assert.equal(ui.locations[0]?.label, "Centro");
    assert.equal(ui.locations[0]?.capacityPerSlot, 3);
    assert.equal(ui.locations[1]?.enabled, false);
  });

  it("normaliza legacy minLeadDays a minLeadHours", () => {
    const ui = mapSqlConfigToWeeklyUi({
      minLeadDays: 2,
      timezone: "America/Monterrey",
      allowed_weekdays: [1],
      slots: ["11:00"],
      locations: { sede: { enabled: true, capacity_per_slot: 1 } },
    });
    assert.equal(ui.minLeadHours, 48);
  });

  it("retorna defaults si config no es objeto", () => {
    const ui = mapSqlConfigToWeeklyUi(null);
    assert.deepEqual(ui, emptyAgendaBiometricosWeeklyConfig());
  });
});

describe("mapWeeklyUiToSqlCanonical", () => {
  it("mapea UI semanal a JSON canónico para RPC", () => {
    const sql = mapWeeklyUiToSqlCanonical({
      enabled: true,
      timezone: "America/Mexico_City",
      minLeadHours: 12,
      allowedWeekdays: [2, 2, 4],
      slots: ["10:00", "09:00", "09:00"],
      locations: [
        {
          id: "mty-centro",
          label: "Centro MTY",
          enabled: true,
          capacityPerSlot: 4,
        },
      ],
    });

    assert.equal(sql.enabled, true);
    assert.equal(sql.timezone, "America/Mexico_City");
    assert.equal(sql.min_lead_hours, 12);
    assert.deepEqual(sql.allowed_weekdays, [2, 4]);
    assert.deepEqual(sql.slots, ["09:00", "10:00"]);
    assert.deepEqual(sql.locations["mty-centro"], {
      enabled: true,
      capacity_per_slot: 4,
      label: "Centro MTY",
    });
  });

  it("round-trip conserva capacity_by_time", () => {
    const source = {
      enabled: true,
      timezone: "America/Monterrey",
      minLeadHours: 24,
      allowedWeekdays: [1, 2, 3, 4, 5],
      slots: ["08:00" as const, "10:00" as const],
      locations: [
        {
          id: "monterrey",
          label: "Monterrey",
          enabled: true,
          capacityPerSlot: 15,
          capacityByTime: { "08:00": 8, "10:00": 5 },
        },
        {
          id: "apodaca",
          label: "Apodaca",
          enabled: true,
          capacityPerSlot: 10,
          capacityByTime: { "08:00": 5, "10:00": 10 },
        },
      ],
    };
    const sql = mapWeeklyUiToSqlCanonical(source);
    assert.deepEqual(sql.locations.monterrey?.capacity_by_time, { "08:00": 8, "10:00": 5 });
    assert.deepEqual(sql.locations.apodaca?.capacity_by_time, { "08:00": 5, "10:00": 10 });
    const roundTrip = mapSqlConfigToWeeklyUi(sql);
    const mty = roundTrip.locations.find((l) => l.id === "monterrey");
    const apo = roundTrip.locations.find((l) => l.id === "apodaca");
    assert.equal(mty?.capacityByTime?.["08:00"], 8);
    assert.equal(mty?.capacityByTime?.["10:00"], 5);
    assert.equal(apo?.capacityByTime?.["08:00"], 5);
  });

  it("round-trip conserva datos principales", () => {
    const source = {
      enabled: false,
      timezone: "America/Monterrey",
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      slots: ["08:00" as const, "16:00" as const],
      locations: [
        {
          id: "apodaca",
          label: "Apodaca",
          enabled: true,
          capacityPerSlot: 2,
        },
      ],
    };
    const roundTrip = mapSqlConfigToWeeklyUi(mapWeeklyUiToSqlCanonical(source));
    assert.equal(roundTrip.enabled, source.enabled);
    assert.equal(roundTrip.timezone, source.timezone);
    assert.equal(roundTrip.minLeadHours, source.minLeadHours);
    assert.deepEqual(roundTrip.allowedWeekdays, source.allowedWeekdays);
    assert.deepEqual(roundTrip.slots, source.slots);
    assert.equal(roundTrip.locations[0]?.id, "apodaca");
    assert.equal(roundTrip.locations[0]?.capacityPerSlot, 2);
  });
});

describe("slugifyAgendaLocationId", () => {
  it("genera ids válidos para sedes", () => {
    assert.equal(slugifyAgendaLocationId("Monterrey Centro"), "monterrey-centro");
    assert.match(slugifyAgendaLocationId(""), /^ubicacion-/);
  });
});
