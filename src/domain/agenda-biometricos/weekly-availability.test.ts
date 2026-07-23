import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyAgendaBiometricosWeeklyConfig } from "./map-agenda-config";
import {
  buildScheduledAtIso,
  computeWeeklySlotAvailability,
  getIsoWeekdayForDate,
  listBookableDatesInRange,
} from "./weekly-availability";
import type { HhmmTime, YmdDate } from "./types";

describe("weekly-availability", () => {
  it("getIsoWeekdayForDate: lunes en America/Monterrey", () => {
    assert.equal(getIsoWeekdayForDate("2026-06-29" as YmdDate, "America/Monterrey"), 1);
  });

  it("buildScheduledAtIso: conserva hora local al formatear en zona", () => {
    const iso = buildScheduledAtIso(
      "2026-06-30" as YmdDate,
      "09:00" as HhmmTime,
      "America/Monterrey",
    );
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Monterrey",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .reduce<Record<string, string>>((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
    assert.equal(`${parts.year}-${parts.month}-${parts.day}`, "2026-06-30");
    assert.equal(`${parts.hour}:${parts.minute}`, "09:00");
  });

  it("computeWeeklySlotAvailability: resta bookings y respeta capacidad", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      enabled: true,
      timezone: "America/Monterrey",
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      slots: ["09:00" as HhmmTime],
      locations: [
        { id: "apodaca", label: "Apodaca", enabled: true, capacityPerSlot: 2, capacityByTime: { "09:00": 2 } },
      ],
    };
    const bookedSlots = [
      {
        bookingDate: "2026-06-29",
        bookingTime: "09:00",
        locationId: "apodaca",
      },
    ];
    const slots = computeWeeklySlotAvailability({
      config,
      bookedSlots,
      date: "2026-06-29" as YmdDate,
      locationId: "apodaca",
      now: new Date("2026-06-25T12:00:00.000Z"),
    });
    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.bookedCount, 1);
    assert.equal(slots[0]?.remaining, 1);
  });

  it("computeWeeklySlotAvailability: día no permitido devuelve vacío", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      allowedWeekdays: [1, 2, 3, 4, 5],
      locations: [{ id: "apodaca", label: "Apodaca", enabled: true, capacityPerSlot: 1, capacityByTime: { "09:00": 1 } }],
      slots: ["09:00" as HhmmTime],
      minLeadHours: 0,
    };
    const slots = computeWeeklySlotAvailability({
      config,
      bookedSlots: [],
      date: "2026-06-27" as YmdDate,
      locationId: "apodaca",
      now: new Date("2026-06-20T12:00:00.000Z"),
    });
    assert.equal(slots.length, 0);
  });

  it("listBookableDatesInRange: incluye solo fechas con cupo", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      locations: [{ id: "apodaca", label: "Apodaca", enabled: true, capacityPerSlot: 1, capacityByTime: { "09:00": 1 } }],
      slots: ["09:00" as HhmmTime],
    };
    const dates = listBookableDatesInRange({
      config,
      bookedSlots: [
        { bookingDate: "2026-06-29", bookingTime: "09:00", locationId: "apodaca" },
      ],
      fromDate: "2026-06-29" as YmdDate,
      toDate: "2026-06-30" as YmdDate,
      locationId: "apodaca",
      now: new Date("2026-06-25T12:00:00.000Z"),
    });
    assert.deepEqual(dates, ["2026-06-30"]);
  });

  it("computeWeeklySlotAvailability: capacity_by_time recurrente (P123)", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      enabled: true,
      timezone: "America/Monterrey",
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      slots: ["08:00" as HhmmTime, "10:00" as HhmmTime],
      locations: [
        {
          id: "monterrey",
          label: "Monterrey",
          enabled: true,
          capacityPerSlot: 15,
          capacityByTime: { "08:00": 8, "10:00": 5 },
        },
      ],
    };
    const slots = computeWeeklySlotAvailability({
      config,
      bookedSlots: [
        { bookingDate: "2026-06-29", bookingTime: "08:00", locationId: "monterrey" },
      ],
      date: "2026-06-29" as YmdDate,
      locationId: "monterrey",
      now: new Date("2026-06-25T12:00:00.000Z"),
    });
    assert.equal(slots.find((s) => s.time === "08:00")?.capacity, 8);
    assert.equal(slots.find((s) => s.time === "08:00")?.remaining, 7);
    assert.equal(slots.find((s) => s.time === "10:00")?.capacity, 5);
    assert.equal(slots.find((s) => s.time === "10:00")?.remaining, 5);
  });

  it("P124: sin capacity_by_time no ofrece el horario (sin fallback)", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      enabled: true,
      timezone: "America/Monterrey",
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      slots: ["08:00" as HhmmTime, "10:00" as HhmmTime],
      locations: [
        {
          id: "monterrey",
          label: "Monterrey",
          enabled: true,
          capacityPerSlot: 15,
          capacityByTime: { "08:00": 8 },
        },
      ],
    };
    const slots = computeWeeklySlotAvailability({
      config,
      bookedSlots: [],
      date: "2026-06-29" as YmdDate,
      locationId: "monterrey",
      now: new Date("2026-06-25T12:00:00.000Z"),
    });
    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.time, "08:00");
  });

  it("computeWeeklySlotAvailability: excepción fecha gana sobre capacity_by_time", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      enabled: true,
      timezone: "America/Monterrey",
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      slots: ["10:00" as HhmmTime],
      locations: [
        {
          id: "monterrey",
          label: "Monterrey",
          enabled: true,
          capacityPerSlot: 15,
          capacityByTime: { "10:00": 5 },
        },
      ],
    };
    const slots = computeWeeklySlotAvailability({
      config,
      bookedSlots: [],
      date: "2026-06-29" as YmdDate,
      locationId: "monterrey",
      now: new Date("2026-06-25T12:00:00.000Z"),
      capacityOverrides: { capacityByTime: { "10:00": 3 } },
    });
    assert.equal(slots[0]?.capacity, 3);
  });

  it("computeWeeklySlotAvailability: override capacityByTime (P118)", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      enabled: true,
      timezone: "America/Monterrey",
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      slots: ["09:00" as HhmmTime, "10:00" as HhmmTime],
      locations: [
        { id: "monterrey", label: "Monterrey", enabled: true, capacityPerSlot: 2, capacityByTime: { "09:00": 2, "10:00": 2 } },
      ],
    };
    const slots = computeWeeklySlotAvailability({
      config,
      bookedSlots: [],
      date: "2026-06-29" as YmdDate,
      locationId: "monterrey",
      now: new Date("2026-06-25T12:00:00.000Z"),
      capacityOverrides: {
        capacityByTime: { "09:00": 7 },
        inactiveTimes: new Set(["10:00"]),
        hideInactive: true,
      },
    });
    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.time, "09:00");
    assert.equal(slots[0]?.capacity, 7);
    assert.equal(slots[0]?.remaining, 7);
  });

  it("computeWeeklySlotAvailability: inactive sin hide → Horario lleno (remaining 0)", () => {
    const config = {
      ...emptyAgendaBiometricosWeeklyConfig(),
      enabled: true,
      timezone: "America/Monterrey",
      minLeadHours: 0,
      allowedWeekdays: [1, 2, 3, 4, 5],
      slots: ["09:00" as HhmmTime],
      locations: [
        { id: "monterrey", label: "Monterrey", enabled: true, capacityPerSlot: 5, capacityByTime: { "09:00": 5 } },
      ],
    };
    const slots = computeWeeklySlotAvailability({
      config,
      bookedSlots: [],
      date: "2026-06-29" as YmdDate,
      locationId: "monterrey",
      now: new Date("2026-06-25T12:00:00.000Z"),
      capacityOverrides: {
        inactiveTimes: new Set(["09:00"]),
        hideInactive: false,
      },
    });
    assert.equal(slots.length, 1);
    assert.equal(slots[0]?.remaining, 0);
  });
});
