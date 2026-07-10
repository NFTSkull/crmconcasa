import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapCalendarEntriesToOrgBookedSlots } from "@/domain/agenda-calendar/supabase.repo";
import type { AsesorAgendaCalendarEntry } from "@/lib/asesorAgendaCalendar";

function entry(
  overrides: Partial<AsesorAgendaCalendarEntry> & Pick<AsesorAgendaCalendarEntry, "bookingId">,
): AsesorAgendaCalendarEntry {
  return {
    bookingDate: "2026-07-15",
    bookingTime: "10:00",
    kind: "biometricos",
    status: "booked",
    locationId: "sede-centro",
    asesorId: "a1",
    asesorFullName: "Ana",
    asesorEmail: "ana@test.c",
    ...overrides,
  };
}

describe("mapCalendarEntriesToOrgBookedSlots", () => {
  it("incluye bookings activos org-wide del kind solicitado", () => {
    const rows = mapCalendarEntriesToOrgBookedSlots(
      [
        entry({ bookingId: "1", kind: "biometricos" }),
        entry({ bookingId: "2", kind: "firmas", bookingTime: "11:00" }),
        entry({ bookingId: "3", kind: "biometricos", status: "cancelled" }),
      ],
      "biometricos",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.bookingTime, "10:00");
  });

  it("filtra por location_id cuando se pide", () => {
    const rows = mapCalendarEntriesToOrgBookedSlots(
      [
        entry({ bookingId: "1", locationId: "sede-centro" }),
        entry({ bookingId: "2", locationId: "sede-norte", bookingTime: "11:00" }),
      ],
      "biometricos",
      "sede-norte",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.locationId, "sede-norte");
  });

  it("firmas y biométricos son cupos separados por kind", () => {
    const bio = mapCalendarEntriesToOrgBookedSlots(
      [entry({ bookingId: "1", kind: "biometricos" })],
      "biometricos",
    );
    const firma = mapCalendarEntriesToOrgBookedSlots(
      [entry({ bookingId: "2", kind: "firmas" })],
      "firmas",
    );
    assert.equal(bio.length, 1);
    assert.equal(firma.length, 1);
  });
});
