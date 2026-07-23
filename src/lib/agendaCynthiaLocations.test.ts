import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CYNTHIA_SEDE_APODACA_ID,
  CYNTHIA_SEDE_MONTERREY_ID,
  cynthiaFormToWeeklyLocations,
  missingExplicitSlotCapacities,
  parseHhmmSlotInput,
  resolveCanonicalSedeId,
  weeklyLocationsToCynthiaForm,
} from "./agendaCynthiaLocations";

describe("resolveCanonicalSedeId", () => {
  it("mapea IDs legacy conocidos", () => {
    assert.equal(resolveCanonicalSedeId("mty-centro", "Centro"), CYNTHIA_SEDE_MONTERREY_ID);
    assert.equal(resolveCanonicalSedeId("san-nicolas", ""), CYNTHIA_SEDE_APODACA_ID);
    assert.equal(resolveCanonicalSedeId("sede-avanzar", "Otra"), null);
  });
});

describe("weeklyLocationsToCynthiaForm", () => {
  it("colapsa sedes legacy a Monterrey y Apodaca", () => {
    const form = weeklyLocationsToCynthiaForm([
      { id: "mty-centro", label: "Centro", enabled: true, capacityPerSlot: 3 },
      { id: "san-nicolas", label: "San Nicolás", enabled: true, capacityPerSlot: 2 },
      { id: "sede-avanzar", label: "Avanzar", enabled: true, capacityPerSlot: 9 },
    ]);
    assert.equal(form.monterrey.enabled, true);
    assert.equal(form.monterrey.capacityPerSlot, 3);
    assert.equal(form.apodaca.enabled, true);
    assert.equal(form.apodaca.capacityPerSlot, 2);
  });

  it("retorna defaults si no hay sedes", () => {
    const form = weeklyLocationsToCynthiaForm([]);
    assert.equal(form.monterrey.enabled, true);
    assert.equal(form.apodaca.enabled, true);
  });
});

describe("cynthiaFormToWeeklyLocations", () => {
  it("persiste solo monterrey y apodaca", () => {
    const locs = cynthiaFormToWeeklyLocations({
      monterrey: { enabled: true, capacityPerSlot: 4, capacityByTime: {} },
      apodaca: { enabled: false, capacityPerSlot: 2, capacityByTime: {} },
    });
    assert.equal(locs.length, 2);
    assert.equal(locs[0]?.id, CYNTHIA_SEDE_MONTERREY_ID);
    assert.equal(locs[1]?.id, CYNTHIA_SEDE_APODACA_ID);
    assert.equal(locs[1]?.enabled, false);
  });
});

describe("parseHhmmSlotInput", () => {
  it("valida HH:mm y rechaza duplicados de formato", () => {
    assert.equal(parseHhmmSlotInput("9:00"), "09:00");
    assert.equal(parseHhmmSlotInput("25:00"), null);
    assert.equal(parseHhmmSlotInput("abc"), null);
  });
});

describe("missingExplicitSlotCapacities P124", () => {
  it("bloquea si falta cupo en sede activa", () => {
    const msg = missingExplicitSlotCapacities(["08:00", "10:00"], {
      monterrey: { enabled: true, capacityPerSlot: 15, capacityByTime: { "08:00": 8 } },
      apodaca: { enabled: true, capacityPerSlot: 10, capacityByTime: { "08:00": 5, "10:00": 10 } },
    });
    assert.match(String(msg), /10:00/);
    assert.match(String(msg), /Monterrey/);
  });

  it("ok si todas las sedes activas tienen cupo", () => {
    const msg = missingExplicitSlotCapacities(["08:00"], {
      monterrey: { enabled: true, capacityPerSlot: 15, capacityByTime: { "08:00": 8 } },
      apodaca: { enabled: false, capacityPerSlot: 10, capacityByTime: {} },
    });
    assert.equal(msg, null);
  });

  it("P126: acepta cupo 0 (cerrado) y rechaza vacío", () => {
    assert.equal(
      missingExplicitSlotCapacities(["08:30"], {
        monterrey: { enabled: true, capacityPerSlot: 5, capacityByTime: { "08:30": 5 } },
        apodaca: { enabled: true, capacityPerSlot: 5, capacityByTime: { "08:30": 0 } },
      }),
      null,
    );
    assert.match(
      String(
        missingExplicitSlotCapacities(["08:30"], {
          monterrey: { enabled: true, capacityPerSlot: 5, capacityByTime: { "08:30": 5 } },
          apodaca: { enabled: true, capacityPerSlot: 5, capacityByTime: {} },
        }),
      ),
      /Apodaca/,
    );
  });
});
