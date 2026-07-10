import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asesorAgendaCalendarDisplayName,
  compareCalendarEntries,
  computeCalendarMonthRange,
  filterCalendarEntries,
  groupCalendarEntriesByDate,
  normalizeBookingTime,
  type AsesorAgendaCalendarEntry,
} from "./asesorAgendaCalendar";

function entry(
  overrides: Partial<AsesorAgendaCalendarEntry> & Pick<AsesorAgendaCalendarEntry, "bookingId">,
): AsesorAgendaCalendarEntry {
  return {
    bookingDate: "2026-07-10",
    bookingTime: "10:00",
    kind: "biometricos",
    status: "booked",
    locationId: "sede-centro",
    asesorId: "asesor-1",
    asesorFullName: "Ana López",
    asesorEmail: "ana@test.c",
    ...overrides,
  };
}

describe("asesorAgendaCalendar helpers", () => {
  it("normaliza hora HH:mm", () => {
    assert.equal(normalizeBookingTime("10:00:00"), "10:00");
    assert.equal(normalizeBookingTime("09:30"), "09:30");
    assert.equal(normalizeBookingTime("8:00"), "08:00");
  });

  it("ordena por fecha y hora", () => {
    const sorted = [
      entry({ bookingId: "b", bookingDate: "2026-07-11", bookingTime: "09:00" }),
      entry({ bookingId: "a", bookingDate: "2026-07-10", bookingTime: "16:00" }),
      entry({ bookingId: "c", bookingDate: "2026-07-10", bookingTime: "10:00" }),
    ].sort(compareCalendarEntries);
    assert.deepEqual(sorted.map((e) => e.bookingId), ["c", "a", "b"]);
  });

  it("agrupa citas por día", () => {
    const grouped = groupCalendarEntriesByDate([
      entry({ bookingId: "1", bookingDate: "2026-07-10", bookingTime: "11:00" }),
      entry({ bookingId: "2", bookingDate: "2026-07-11", bookingTime: "09:00" }),
      entry({ bookingId: "3", bookingDate: "2026-07-10", bookingTime: "10:00" }),
    ]);
    assert.equal(grouped["2026-07-10"]?.length, 2);
    assert.equal(grouped["2026-07-11"]?.length, 1);
    assert.equal(grouped["2026-07-10"]?.[0]?.bookingId, "3");
  });

  it("filtra biométricos del día", () => {
    const rows = filterCalendarEntries(
      [
        entry({ bookingId: "bio", kind: "biometricos" }),
        entry({ bookingId: "fir", kind: "firmas", bookingTime: "11:00" }),
      ],
      { kind: "biometricos", includeCancelled: false, selectedDate: "2026-07-10" },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.bookingId, "bio");
  });

  it("filtra firma del día", () => {
    const rows = filterCalendarEntries(
      [
        entry({ bookingId: "bio", kind: "biometricos" }),
        entry({ bookingId: "fir", kind: "firmas", bookingTime: "11:00" }),
      ],
      { kind: "firmas", includeCancelled: false, selectedDate: "2026-07-10" },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.bookingId, "fir");
  });

  it("filtra notificación del día", () => {
    const rows = filterCalendarEntries(
      [
        entry({ bookingId: "bio", kind: "biometricos" }),
        entry({ bookingId: "notif", kind: "notificacion", bookingTime: "12:00" }),
      ],
      { kind: "notificacion", includeCancelled: false, selectedDate: "2026-07-10" },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.bookingId, "notif");
    assert.equal(rows[0]?.bookingTime, "12:00");
  });

  it("excluye canceladas por defecto", () => {
    const rows = filterCalendarEntries(
      [
        entry({ bookingId: "active", status: "booked" }),
        entry({ bookingId: "cancel", status: "cancelled", bookingTime: "12:00" }),
      ],
      { kind: "all", includeCancelled: false, selectedDate: "2026-07-10" },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.bookingId, "active");
  });

  it("incluye canceladas cuando se pide", () => {
    const rows = filterCalendarEntries(
      [
        entry({ bookingId: "active", status: "booked" }),
        entry({ bookingId: "cancel", status: "cancelled", bookingTime: "12:00" }),
      ],
      { kind: "all", includeCancelled: true, selectedDate: "2026-07-10" },
    );
    assert.equal(rows.length, 2);
  });

  it("muestra nombre del asesor con fallback a email", () => {
    assert.equal(
      asesorAgendaCalendarDisplayName(
        entry({ bookingId: "1", asesorFullName: "Pedro", asesorEmail: "p@test.c" }),
      ),
      "Pedro",
    );
    assert.equal(
      asesorAgendaCalendarDisplayName(
        entry({ bookingId: "2", asesorFullName: null, asesorEmail: "p@test.c" }),
      ),
      "p@test.c",
    );
  });

  it("día sin citas devuelve lista vacía", () => {
    const rows = filterCalendarEntries(
      [entry({ bookingId: "1", bookingDate: "2026-07-11" })],
      { kind: "all", includeCancelled: false, selectedDate: "2026-07-10" },
    );
    assert.equal(rows.length, 0);
  });

  it("calcula rango mensual", () => {
    const range = computeCalendarMonthRange(2026, 6);
    assert.equal(range.startDate, "2026-07-01");
    assert.equal(range.endDate, "2026-07-31");
  });
});
