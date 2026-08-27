import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BIOMETRICOS_MONTERREY_DAILY_CAPACITY,
  agendaDailyActiveOccupancy,
  agendaDailyCapacity,
  agendaDailyRemaining,
  effectiveSlotRemainingWithDaily,
  shouldBlockBookWithoutLiveSync,
} from "./daily-capacity";

function bookings(n: number): { id: string; status: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i + 1}`,
    status: "booked",
  }));
}

function external(n: number): { status: string; bookingId: null }[] {
  return Array.from({ length: n }, () => ({
    status: "occupied_external",
    bookingId: null,
  }));
}

function linkedTo(ids: string[]) {
  return ids.map((id) => ({ status: "linked" as const, bookingId: id }));
}

describe("P208 daily capacity biometricos Monterrey", () => {
  it("D1 0 CRM + 0 externos remaining 15", () => {
    const occ = agendaDailyActiveOccupancy({ bookings: [], inventory: [] });
    assert.equal(occ, 0);
    assert.equal(agendaDailyRemaining("biometricos", "monterrey", occ).remaining, 15);
  });

  it("D2 10 CRM remaining 5", () => {
    const occ = agendaDailyActiveOccupancy({
      bookings: bookings(10),
      inventory: linkedTo(bookings(10).map((b) => b.id)),
    });
    assert.equal(occ, 10);
    assert.equal(agendaDailyRemaining("biometricos", "monterrey", occ).remaining, 5);
  });

  it("D3 0 CRM + 10 externos remaining 5", () => {
    const occ = agendaDailyActiveOccupancy({
      bookings: [],
      inventory: external(10),
    });
    assert.equal(agendaDailyRemaining("biometricos", "monterrey", occ).remaining, 5);
  });

  it("D4 8 CRM + 6 externos remaining 1", () => {
    const b = bookings(8);
    const occ = agendaDailyActiveOccupancy({
      bookings: b,
      inventory: [...linkedTo(b.map((x) => x.id)), ...external(6)],
    });
    assert.equal(occ, 14);
    assert.equal(agendaDailyRemaining("biometricos", "monterrey", occ).remaining, 1);
  });

  it("D5 9 CRM + 6 externos remaining 0", () => {
    const b = bookings(9);
    const occ = agendaDailyActiveOccupancy({
      bookings: b,
      inventory: [...linkedTo(b.map((x) => x.id)), ...external(6)],
    });
    assert.equal(occ, 15);
    assert.equal(agendaDailyRemaining("biometricos", "monterrey", occ).remaining, 0);
  });

  it("D6/D20 #16 occupancy 15 remaining 0", () => {
    const r = agendaDailyRemaining("biometricos", "monterrey", 15);
    assert.equal(r.remaining, 0);
    assert.equal(r.overcapacity, false);
  });

  it("D7 15 externos nuevo CRM remaining 0", () => {
    const occ = agendaDailyActiveOccupancy({
      bookings: [],
      inventory: external(15),
    });
    assert.equal(agendaDailyRemaining("biometricos", "monterrey", occ).remaining, 0);
  });

  it("D8 11 CRM + 4 externos remaining 0", () => {
    const b = bookings(11);
    const occ = agendaDailyActiveOccupancy({
      bookings: b,
      inventory: [...linkedTo(b.map((x) => x.id)), ...external(4)],
    });
    assert.equal(occ, 15);
    assert.equal(agendaDailyRemaining("biometricos", "monterrey", occ).remaining, 0);
  });

  it("D9 linked/claimed CRM no doble conteo", () => {
    const b = bookings(5);
    const occ = agendaDailyActiveOccupancy({
      bookings: b,
      inventory: [
        ...linkedTo(b.map((x) => x.id)),
        ...b.map((x) => ({ status: "claimed", bookingId: x.id })),
      ],
    });
    assert.equal(occ, 5);
  });

  it("D10/D11 filas available extra no aumentan capacity", () => {
    assert.equal(agendaDailyCapacity("biometricos", "monterrey"), 15);
    const avail = Array.from({ length: 20 }, () => ({
      status: "available",
      bookingId: null,
    }));
    const occ = agendaDailyActiveOccupancy({
      bookings: bookings(10),
      inventory: [...linkedTo(bookings(10).map((b) => b.id)), ...avail],
    });
    assert.equal(occ, 10);
    assert.equal(agendaDailyRemaining("biometricos", "monterrey", occ).remaining, 5);
  });

  it("D12/D24 occupied_external cuenta", () => {
    const occ = agendaDailyActiveOccupancy({
      bookings: [],
      inventory: [{ status: "occupied_external", bookingId: null }],
    });
    assert.equal(occ, 1);
  });

  it("D13 cancel CRM libera 1", () => {
    const before = agendaDailyActiveOccupancy({
      bookings: bookings(3),
      inventory: linkedTo(["b1", "b2", "b3"]),
    });
    const after = agendaDailyActiveOccupancy({
      bookings: [
        { id: "b1", status: "cancelled" },
        { id: "b2", status: "booked" },
        { id: "b3", status: "booked" },
      ],
      inventory: [
        { status: "available", bookingId: null },
        { status: "linked", bookingId: "b2" },
        { status: "linked", bookingId: "b3" },
      ],
    });
    assert.equal(before - after, 1);
  });

  it("D14 cancel CRM no libera manual external", () => {
    const occ = agendaDailyActiveOccupancy({
      bookings: [{ id: "b1", status: "cancelled" }],
      inventory: external(4),
    });
    assert.equal(occ, 4);
  });

  it("D15 reagendar mismo día no aumenta (misma occupancy)", () => {
    const occ = agendaDailyActiveOccupancy({
      bookings: bookings(8),
      inventory: [...linkedTo(bookings(8).map((b) => b.id)), ...external(2)],
    });
    assert.equal(occ, 10);
  });

  it("D21/D22/D23 min horario vs daily vs físico", () => {
    assert.equal(
      effectiveSlotRemainingWithDaily({
        perHourRemaining: 4,
        physicalAvailable: 5,
        dailyRemaining: 1,
      }),
      1,
    );
    assert.equal(
      effectiveSlotRemainingWithDaily({
        perHourRemaining: 4,
        physicalAvailable: 5,
        dailyRemaining: 0,
      }),
      0,
    );
    assert.equal(
      effectiveSlotRemainingWithDaily({
        perHourRemaining: 0,
        physicalAvailable: 5,
        dailyRemaining: 10,
      }),
      0,
    );
  });

  it("D25 disabled no cuenta", () => {
    const occ = agendaDailyActiveOccupancy({
      bookings: [],
      inventory: [
        { status: "disabled", bookingId: null },
        { status: "available", bookingId: null },
      ],
    });
    assert.equal(occ, 0);
  });

  it("D26 conflict no regala cupo", () => {
    const occ = agendaDailyActiveOccupancy({
      bookings: [],
      inventory: [{ status: "conflict", bookingId: null }],
    });
    assert.equal(occ, 1);
  });

  it("D27/D28/D29 Apodaca bio sin cap; Firmas P212 monterrey/apodaca=15", () => {
    assert.equal(agendaDailyCapacity("biometricos", "apodaca"), null);
    assert.equal(agendaDailyCapacity("firmas", "monterrey"), null);
    assert.equal(agendaDailyCapacity("firmas", "apodaca"), null);
    assert.equal(
      agendaDailyCapacity("firmas", "monterrey", { enabled: true }),
      15,
    );
    assert.equal(
      agendaDailyCapacity("firmas", "apodaca", { enabled: true }),
      15,
    );
    assert.equal(agendaDailyCapacity("inscripcion", "monterrey"), null);
    assert.equal(
      agendaDailyRemaining("firmas", "monterrey", 14, { enabled: true }).remaining,
      1,
    );
    assert.equal(
      agendaDailyRemaining("firmas", "monterrey", 14).remaining,
      null,
    );
  });

  it("D30 17 filas físicas 13 ocupadas remaining 2", () => {
    const b = bookings(8);
    const inv = [
      ...linkedTo(b.map((x) => x.id)),
      ...external(5),
      ...Array.from({ length: 4 }, () => ({
        status: "available",
        bookingId: null,
      })),
    ];
    const occ = agendaDailyActiveOccupancy({ bookings: b, inventory: inv });
    assert.equal(occ, 13);
    assert.equal(agendaDailyRemaining("biometricos", "monterrey", occ).remaining, 2);
    assert.equal(BIOMETRICOS_MONTERREY_DAILY_CAPACITY, 15);
  });

  it("D19 live-sync fail closed no llama book", () => {
    const blocked = shouldBlockBookWithoutLiveSync({
      kind: "biometricos",
      locationId: "monterrey",
      bookingDate: "2026-08-24",
      gate: null,
    });
    assert.equal(blocked.block, true);
    assert.match(blocked.message ?? "", /verificar el cupo/i);

    const ok = shouldBlockBookWithoutLiveSync({
      kind: "biometricos",
      locationId: "monterrey",
      bookingDate: "2026-08-24",
      gate: { fresh: true, canBook: true },
    });
    assert.equal(ok.block, false);
  });

  it("overcapacity Sheet remaining 0", () => {
    const r = agendaDailyRemaining("biometricos", "monterrey", 17);
    assert.equal(r.remaining, 0);
    assert.equal(r.overcapacity, true);
  });
});
