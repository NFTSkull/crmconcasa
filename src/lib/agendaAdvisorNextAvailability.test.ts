import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyAgendaBiometricosWeeklyConfig } from "@/domain/agenda-biometricos/map-agenda-config";
import type { HhmmTime, YmdDate } from "@/domain/agenda-biometricos/types";
import { buildAdvisorSedeOptions } from "./agendaAdvisorLocations";
import {
  buildAdvisorDateAvailabilityInsight,
  findNextAvailableAgendaSlot,
  formatAdvisorNextSlotLabel,
} from "./agendaAdvisorNextAvailability";

function sedeFromConfig(
  config: ReturnType<typeof baseConfig>,
  canonical: "monterrey" | "apodaca",
) {
  return buildAdvisorSedeOptions(config.locations).find((s) => s.canonicalId === canonical)!;
}

function baseConfig() {
  return {
    ...emptyAgendaBiometricosWeeklyConfig(),
    enabled: true,
    timezone: "America/Monterrey",
    minLeadHours: 24,
    allowedWeekdays: [1, 2, 3, 4, 5],
    slots: ["09:00", "10:00", "14:00"] as HhmmTime[],
    locations: [
      {
        id: "monterrey",
        label: "Monterrey",
        enabled: true,
        capacityPerSlot: 2,
        capacityByTime: { "09:00": 2, "10:00": 2, "14:00": 2 },
      },
      {
        id: "apodaca",
        label: "Apodaca",
        enabled: true,
        capacityPerSlot: 2,
        capacityByTime: { "09:00": 2, "10:00": 2, "14:00": 2 },
      },
    ],
  };
}

describe("findNextAvailableAgendaSlot", () => {
  it("sábado no habilitado sugiere lunes siguiente", () => {
    const config = baseConfig();
    const monterrey = sedeFromConfig(config, "monterrey");
    const now = new Date("2026-06-25T18:00:00.000Z");
    const saturday = "2026-06-27" as YmdDate;
    const next = findNextAvailableAgendaSlot({
      config,
      bookedSlots: [],
      fromDate: saturday,
      sede: monterrey,
      now,
    });
    assert.ok(next);
    assert.equal(next?.date, "2026-06-29");
    assert.equal(next?.time, "09:00");
    assert.equal(next?.sedeLabel, "Monterrey");
  });

  it("anticipación mínima bloquea hoy y sugiere día hábil siguiente", () => {
    const config = { ...baseConfig(), minLeadHours: 48 };
    const monterrey = sedeFromConfig(config, "monterrey");
    const now = new Date("2026-06-25T18:00:00.000Z");
    const thursday = "2026-06-25" as YmdDate;
    const next = findNextAvailableAgendaSlot({
      config,
      bookedSlots: [],
      fromDate: thursday,
      sede: monterrey,
      now,
    });
    assert.ok(next);
    assert.equal(next!.date > thursday, true);
    assert.equal(next?.sedeLabel, "Monterrey");
  });

  it("horarios llenos busca siguiente día con cupo", () => {
    const config = baseConfig();
    const monterrey = sedeFromConfig(config, "monterrey");
    const monday = "2026-06-29" as YmdDate;
    const bookedSlots = [
      { bookingDate: "2026-06-29", bookingTime: "09:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "09:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "10:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "10:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "14:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "14:00", locationId: "monterrey" },
    ];
    const now = new Date("2026-06-25T12:00:00.000Z");
    const next = findNextAvailableAgendaSlot({
      config,
      bookedSlots,
      fromDate: monday,
      sede: monterrey,
      now,
    });
    assert.ok(next);
    assert.equal(next?.date, "2026-06-30");
    assert.equal(next?.time, "09:00");
  });

  it("respeta sede Apodaca sin mezclar Monterrey", () => {
    const config = baseConfig();
    const apodaca = sedeFromConfig(config, "apodaca");
    const now = new Date("2026-06-25T12:00:00.000Z");
    const next = findNextAvailableAgendaSlot({
      config,
      bookedSlots: [],
      fromDate: "2026-06-29" as YmdDate,
      sede: apodaca,
      now,
    });
    assert.equal(next?.sedeLabel, "Apodaca");
    assert.ok(!formatAdvisorNextSlotLabel(next!, config.timezone).includes("mty-centro"));
  });

  it("sin disponibilidad futura en 45 días retorna null", () => {
    const config = {
      ...baseConfig(),
      allowedWeekdays: [1],
      slots: ["09:00"] as HhmmTime[],
    };
    const monterrey = sedeFromConfig(config, "monterrey");
    const monday = "2026-06-29" as YmdDate;
    const bookedSlots = [
      { bookingDate: "2026-06-29", bookingTime: "09:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "09:00", locationId: "monterrey" },
      { bookingDate: "2026-07-06", bookingTime: "09:00", locationId: "monterrey" },
      { bookingDate: "2026-07-06", bookingTime: "09:00", locationId: "monterrey" },
    ];
    const now = new Date("2026-06-25T12:00:00.000Z");
    const next = findNextAvailableAgendaSlot({
      config,
      bookedSlots,
      fromDate: monday,
      sede: monterrey,
      searchDays: 10,
      now,
    });
    assert.equal(next, null);
  });
});

describe("buildAdvisorDateAvailabilityInsight", () => {
  it("día no habilitado muestra mensaje y próxima fecha", () => {
    const config = baseConfig();
    const monterrey = sedeFromConfig(config, "monterrey");
    const now = new Date("2026-06-25T12:00:00.000Z");
    const insight = buildAdvisorDateAvailabilityInsight({
      config,
      bookedSlots: [],
      date: "2026-06-27" as YmdDate,
      sede: monterrey,
      now,
    });
    assert.equal(insight?.emptyReason, "day_not_enabled");
    assert.equal(insight?.emptyReasonMessage, "Este día no está habilitado para citas.");
    assert.ok(insight?.nextFormatted?.includes("Monterrey"));
    assert.ok(!insight?.nextFormatted?.includes("mty-centro"));
  });

  it("anticipación mínima en fecha seleccionada", () => {
    const config = { ...baseConfig(), minLeadHours: 72 };
    const monterrey = sedeFromConfig(config, "monterrey");
    const now = new Date("2026-06-25T18:00:00.000Z");
    const insight = buildAdvisorDateAvailabilityInsight({
      config,
      bookedSlots: [],
      date: "2026-06-26" as YmdDate,
      sede: monterrey,
      now,
    });
    assert.equal(insight?.emptyReason, "min_lead_blocked");
    assert.match(insight?.emptyReasonMessage ?? "", /anticipación mínima/);
    assert.ok(insight?.next);
  });

  it("horarios llenos muestra mensaje específico", () => {
    const config = baseConfig();
    const monday = "2026-06-29" as YmdDate;
    const bookedSlots = [
      { bookingDate: "2026-06-29", bookingTime: "09:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "09:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "10:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "10:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "14:00", locationId: "monterrey" },
      { bookingDate: "2026-06-29", bookingTime: "14:00", locationId: "monterrey" },
    ];
    const now = new Date("2026-06-25T12:00:00.000Z");
    const insight = buildAdvisorDateAvailabilityInsight({
      config,
      bookedSlots,
      date: monday,
      sede: buildAdvisorSedeOptions(config.locations)[0]!,
      now,
    });
    assert.equal(insight?.emptyReason, "all_full");
    assert.equal(insight?.emptyReasonMessage, "Los horarios de esta fecha ya están llenos.");
    assert.ok(insight?.next);
  });

  it("sin futuro muestra mensaje para Mesa", () => {
    const config = { ...baseConfig(), allowedWeekdays: [] };
    const monterrey = sedeFromConfig(config, "monterrey");
    const insight = buildAdvisorDateAvailabilityInsight({
      config,
      bookedSlots: [],
      date: "2026-06-29" as YmdDate,
      sede: monterrey,
      searchDays: 3,
      now: new Date("2026-06-25T12:00:00.000Z"),
    });
    assert.ok(insight?.noFutureMessage?.includes("Mesa"));
  });
});
