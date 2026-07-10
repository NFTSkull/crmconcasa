import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyAgendaBiometricosWeeklyConfig } from "@/domain/agenda-biometricos/map-agenda-config";
import { computeAdvisorSlotAvailability } from "@/domain/agenda-biometricos/weekly-availability";
import type { HhmmTime, YmdDate } from "@/domain/agenda-biometricos/types";
import {
  ADVISOR_SEDE_LABELS,
  advisorLabelForLocationId,
  advisorOptionIncludesBookingLocation,
  buildAdvisorSedeOptions,
  mapLocationIdToAdvisorCanonical,
} from "./agendaAdvisorLocations";

const LEGACY_LOCATIONS = [
  { id: "mty-centro", label: "Centro", enabled: true, capacityPerSlot: 3 },
  { id: "sede-centro", label: "Sede centro", enabled: true, capacityPerSlot: 5 },
  { id: "san-nicolas", label: "San Nicolás", enabled: true, capacityPerSlot: 2 },
  { id: "sede-avanzar", label: "Avanzar", enabled: true, capacityPerSlot: 4 },
  { id: "sede-db-dup", label: "Dup", enabled: true, capacityPerSlot: 1 },
  { id: "sede-forzada", label: "Forzada", enabled: true, capacityPerSlot: 1 },
  { id: "sede-nueva", label: "Nueva", enabled: true, capacityPerSlot: 1 },
  { id: "sede-original", label: "Original", enabled: true, capacityPerSlot: 1 },
  { id: "sede-reagenda", label: "Reagenda", enabled: true, capacityPerSlot: 1 },
] as const;

describe("buildAdvisorSedeOptions", () => {
  it("colapsa mty-centro y sede-centro en una sola opción Monterrey", () => {
    const options = buildAdvisorSedeOptions(LEGACY_LOCATIONS);
    const monterrey = options.filter((o) => o.label === "Monterrey");
    assert.equal(monterrey.length, 1);
    assert.deepEqual([...monterrey[0]!.sourceLocationIds].sort(), ["mty-centro", "sede-centro"]);
    assert.equal(monterrey[0]?.capacityPerSlot, 5);
  });

  it("mapea san-nicolas como Apodaca", () => {
    const options = buildAdvisorSedeOptions(LEGACY_LOCATIONS);
    const apodaca = options.find((o) => o.label === "Apodaca");
    assert.ok(apodaca);
    assert.deepEqual(apodaca?.sourceLocationIds, ["san-nicolas"]);
  });

  it("ignora sedes legacy desconocidas", () => {
    const options = buildAdvisorSedeOptions(LEGACY_LOCATIONS);
    const allSourceIds = options.flatMap((o) => o.sourceLocationIds);
    assert.ok(!allSourceIds.includes("sede-avanzar"));
    assert.ok(!allSourceIds.includes("sede-db-dup"));
    assert.equal(options.length, 2);
  });

  it("no muestra IDs técnicos en labels del asesor", () => {
    const options = buildAdvisorSedeOptions(LEGACY_LOCATIONS);
    for (const opt of options) {
      assert.ok(opt.label === "Monterrey" || opt.label === "Apodaca");
      assert.equal(opt.label, ADVISOR_SEDE_LABELS[opt.canonicalId]);
      assert.ok(!opt.label.includes("mty-centro"));
      assert.ok(!opt.label.includes("sede-"));
    }
  });

  it("no duplica Monterrey ni Apodaca", () => {
    const options = buildAdvisorSedeOptions([
      ...LEGACY_LOCATIONS,
      { id: "monterrey", label: "Monterrey", enabled: true, capacityPerSlot: 4 },
      { id: "apodaca", label: "Apodaca", enabled: true, capacityPerSlot: 3 },
    ]);
    assert.equal(options.length, 2);
    assert.equal(options[0]?.canonicalId, "monterrey");
    assert.equal(options[1]?.canonicalId, "apodaca");
    assert.equal(options[0]?.bookLocationId, "monterrey");
    assert.equal(options[1]?.bookLocationId, "apodaca");
  });

  it("usa ID canónico para reservar si existe en config", () => {
    const options = buildAdvisorSedeOptions([
      { id: "mty-centro", label: "Centro", enabled: true, capacityPerSlot: 3 },
      { id: "monterrey", label: "Monterrey", enabled: true, capacityPerSlot: 5 },
    ]);
    assert.equal(options[0]?.bookLocationId, "monterrey");
  });

  it("usa primer legacy mapeable si no hay fila canónica", () => {
    const options = buildAdvisorSedeOptions([
      { id: "mty-centro", label: "Centro", enabled: true, capacityPerSlot: 3 },
    ]);
    assert.equal(options[0]?.bookLocationId, "mty-centro");
  });
});

describe("mapLocationIdToAdvisorCanonical", () => {
  it("resuelve booking legacy a canónico", () => {
    assert.equal(
      mapLocationIdToAdvisorCanonical("mty-centro", LEGACY_LOCATIONS),
      "monterrey",
    );
    assert.equal(
      mapLocationIdToAdvisorCanonical("san-nicolas", LEGACY_LOCATIONS),
      "apodaca",
    );
  });
});

describe("advisorLabelForLocationId", () => {
  it("muestra label humano para booking legacy", () => {
    assert.equal(advisorLabelForLocationId("mty-centro", LEGACY_LOCATIONS), "Monterrey");
    assert.equal(advisorLabelForLocationId("san-nicolas", LEGACY_LOCATIONS), "Apodaca");
  });
});

describe("advisorOptionIncludesBookingLocation", () => {
  it("reconoce booking en cualquier source legacy", () => {
    const [monterrey] = buildAdvisorSedeOptions(LEGACY_LOCATIONS);
    assert.ok(monterrey);
    assert.equal(advisorOptionIncludesBookingLocation(monterrey, "sede-centro"), true);
    assert.equal(advisorOptionIncludesBookingLocation(monterrey, "san-nicolas"), false);
  });

  it("mapea booking legacy aunque no esté en sourceLocationIds exactos", () => {
    const locations = [{ id: "monterrey", label: "Monterrey", enabled: true, capacityPerSlot: 16 }];
    const [monterrey] = buildAdvisorSedeOptions(locations);
    assert.ok(monterrey);
    assert.equal(
      advisorOptionIncludesBookingLocation(monterrey, "sede-centro", locations),
      true,
    );
    assert.equal(
      advisorOptionIncludesBookingLocation(monterrey, "monterrey", locations),
      true,
    );
  });
});

describe("computeAdvisorSlotAvailability", () => {
  it("consolida cupos y bookings de sedes legacy Monterrey", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      enabled: true,
      timezone: "America/Monterrey",
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      slots: ["09:00" as HhmmTime],
      locations: [
        { id: "mty-centro", label: "Centro", enabled: true, capacityPerSlot: 3 },
        { id: "sede-centro", label: "Sede centro", enabled: true, capacityPerSlot: 5 },
      ],
    };
    const options = buildAdvisorSedeOptions(config.locations);
    const monterrey = options[0];
    assert.ok(monterrey);

    const slots = computeAdvisorSlotAvailability({
      config,
      bookedSlots: [
        { bookingDate: "2026-06-29", bookingTime: "09:00", locationId: "mty-centro" },
        { bookingDate: "2026-06-29", bookingTime: "09:00", locationId: "sede-centro" },
      ],
      date: "2026-06-29" as YmdDate,
      canonicalId: monterrey.canonicalId,
      sourceLocationIds: monterrey.sourceLocationIds,
      capacityPerSlot: monterrey.capacityPerSlot,
      now: new Date("2026-06-25T12:00:00.000Z"),
    });

    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.capacity, 5);
    assert.equal(slots[0]?.bookedCount, 2);
    assert.equal(slots[0]?.remaining, 3);
    assert.equal(slots[0]?.locationId, "monterrey");
  });

  it("cuenta bookings legacy cuando config solo tiene sede canónica", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      enabled: true,
      timezone: "America/Monterrey",
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5, 6, 7],
      slots: ["08:00" as HhmmTime, "10:00" as HhmmTime],
      locations: [{ id: "monterrey", label: "Monterrey", enabled: true, capacityPerSlot: 16 }],
    };
    const [monterrey] = buildAdvisorSedeOptions(config.locations);
    assert.ok(monterrey);

    const slots = computeAdvisorSlotAvailability({
      config,
      bookedSlots: [
        { bookingDate: "2026-07-14", bookingTime: "08:00:00", locationId: "monterrey" },
        { bookingDate: "2026-07-14", bookingTime: "08:00", locationId: "sede-centro" },
        { bookingDate: "2026-07-14", bookingTime: "10:00:00", locationId: "monterrey" },
      ],
      date: "2026-07-14" as YmdDate,
      canonicalId: monterrey.canonicalId,
      sourceLocationIds: monterrey.sourceLocationIds,
      capacityPerSlot: monterrey.capacityPerSlot,
      now: new Date("2026-01-01"),
    });

    const s08 = slots.find((s) => s.time === "08:00");
    const s10 = slots.find((s) => s.time === "10:00");
    assert.equal(s08?.bookedCount, 2);
    assert.equal(s08?.remaining, 14);
    assert.equal(s10?.bookedCount, 1);
    assert.equal(s10?.remaining, 15);
  });
});
