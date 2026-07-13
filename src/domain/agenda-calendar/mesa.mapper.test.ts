import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareMesaAgendaBookingEntries,
  mapMesaAgendaBookingRpcRow,
  mapMesaAgendaBookingRpcRows,
  mapMesaAgendaBookingsRpcError,
  mesaAgendaBookingPersonDisplayName,
  MesaAgendaBookingsSupabaseError,
  type MesaAgendaBookingRpcRow,
} from "./mesa.mapper";

function fullRpcRow(
  overrides: Partial<MesaAgendaBookingRpcRow> = {},
): MesaAgendaBookingRpcRow {
  return {
    booking_id: "b1111111-1111-4111-8111-111111111111",
    expediente_id: "e2222222-2222-4222-8222-222222222222",
    booking_date: "2026-07-15",
    booking_time: "10:30:00",
    kind: "biometricos",
    status: "booked",
    location_id: "sede-centro",
    note: "nota prueba",
    created_at: "2026-07-01T18:00:00.000Z",
    cancelled_at: null,
    cliente_nombre: "Juan Pérez",
    nss: "12345678901",
    etapa_actual: 3,
    subestado: "en_proceso",
    submitted_to_mesa: true,
    asesor_id: "a3333333-3333-4333-8333-333333333333",
    asesor_full_name: "Ana Asesor",
    asesor_email: "ana@concasa.test",
    created_by: "m4444444-4444-4444-8444-444444444444",
    created_by_full_name: "Mesa Admin",
    created_by_email: "mesa@concasa.test",
    ...overrides,
  };
}

describe("mapMesaAgendaBookingRpcRow", () => {
  it("mapea las 22 columnas y normaliza fecha/hora", () => {
    const entry = mapMesaAgendaBookingRpcRow(fullRpcRow());
    assert.ok(entry);
    assert.equal(entry.bookingId, "b1111111-1111-4111-8111-111111111111");
    assert.equal(entry.expedienteId, "e2222222-2222-4222-8222-222222222222");
    assert.equal(entry.bookingDate, "2026-07-15");
    assert.equal(entry.bookingTime, "10:30");
    assert.equal(entry.kind, "biometricos");
    assert.equal(entry.status, "booked");
    assert.equal(entry.locationId, "sede-centro");
    assert.equal(entry.note, "nota prueba");
    assert.equal(entry.createdAt, "2026-07-01T18:00:00.000Z");
    assert.equal(entry.cancelledAt, null);
    assert.equal(entry.clienteNombre, "Juan Pérez");
    assert.equal(entry.nss, "12345678901");
    assert.equal(entry.etapaActual, 3);
    assert.equal(entry.subestado, "en_proceso");
    assert.equal(entry.submittedToMesa, true);
    assert.equal(entry.asesor.id, "a3333333-3333-4333-8333-333333333333");
    assert.equal(entry.asesor.fullName, "Ana Asesor");
    assert.equal(entry.asesor.email, "ana@concasa.test");
    assert.equal(entry.createdBy.id, "m4444444-4444-4444-8444-444444444444");
    assert.equal(entry.createdBy.fullName, "Mesa Admin");
    assert.equal(entry.createdBy.email, "mesa@concasa.test");
  });

  it("distingue asesor dueño de quien agendó", () => {
    const entry = mapMesaAgendaBookingRpcRow(fullRpcRow());
    assert.ok(entry);
    assert.notEqual(entry.asesor.id, entry.createdBy.id);
    assert.notEqual(entry.asesor.email, entry.createdBy.email);
  });

  it("acepta los tres kinds", () => {
    for (const kind of ["biometricos", "firmas", "notificacion"] as const) {
      const entry = mapMesaAgendaBookingRpcRow(fullRpcRow({ kind }));
      assert.ok(entry);
      assert.equal(entry.kind, kind);
    }
  });

  it("mapea cancelada con cancelled_at", () => {
    const entry = mapMesaAgendaBookingRpcRow(
      fullRpcRow({
        status: "cancelled",
        cancelled_at: "2026-07-02T12:00:00.000Z",
      }),
    );
    assert.ok(entry);
    assert.equal(entry.status, "cancelled");
    assert.equal(entry.cancelledAt, "2026-07-02T12:00:00.000Z");
  });

  it("nss y cliente pueden ser null desde RPC", () => {
    const entry = mapMesaAgendaBookingRpcRow(
      fullRpcRow({ cliente_nombre: null, nss: null }),
    );
    assert.ok(entry);
    assert.equal(entry.clienteNombre, "");
    assert.equal(entry.nss, null);
  });

  it("rechaza fila incompleta", () => {
    assert.equal(mapMesaAgendaBookingRpcRow({ kind: "biometricos" }), null);
    assert.equal(mapMesaAgendaBookingRpcRow(fullRpcRow({ kind: "otro" })), null);
  });
});

describe("mapMesaAgendaBookingRpcRows", () => {
  it("filtra filas inválidas", () => {
    const rows = mapMesaAgendaBookingRpcRows([
      fullRpcRow({ booking_id: "ok-1" }),
      { kind: "firmas" },
      fullRpcRow({ booking_id: "ok-2", kind: "firmas" }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.bookingId, "ok-1");
    assert.equal(rows[1]?.kind, "firmas");
  });
});

describe("mapMesaAgendaBookingsRpcError", () => {
  it("mapea forbidden_role", () => {
    const err = mapMesaAgendaBookingsRpcError({ message: "forbidden_role" });
    assert.ok(err instanceof MesaAgendaBookingsSupabaseError);
    assert.match(err.message, /permiso/i);
  });

  it("mapea profile_inactive", () => {
    const err = mapMesaAgendaBookingsRpcError({ message: "profile_inactive" });
    assert.match(err.message, /sesión/i);
  });

  it("mapea rango inválido", () => {
    const err = mapMesaAgendaBookingsRpcError({ message: "date_range_too_large" });
    assert.match(err.message, /rango/i);
  });

  it("mapea error genérico", () => {
    const err = mapMesaAgendaBookingsRpcError({ message: "unexpected" });
    assert.match(err.message, /agenda de citas/i);
  });
});

describe("compareMesaAgendaBookingEntries", () => {
  it("ordena por fecha, hora y createdAt", () => {
    const a = mapMesaAgendaBookingRpcRow(
      fullRpcRow({
        booking_id: "late",
        booking_date: "2026-07-16",
        booking_time: "09:00:00",
        created_at: "2026-07-01T10:00:00.000Z",
      }),
    )!;
    const b = mapMesaAgendaBookingRpcRow(
      fullRpcRow({
        booking_id: "early",
        booking_date: "2026-07-15",
        booking_time: "16:00:00",
        created_at: "2026-07-01T11:00:00.000Z",
      }),
    )!;
    const c = mapMesaAgendaBookingRpcRow(
      fullRpcRow({
        booking_id: "mid",
        booking_date: "2026-07-15",
        booking_time: "10:00:00",
        created_at: "2026-07-01T09:00:00.000Z",
      }),
    )!;
    const sorted = [a, b, c].sort(compareMesaAgendaBookingEntries);
    assert.deepEqual(sorted.map((r) => r.bookingId), ["mid", "early", "late"]);
  });
});

describe("mesaAgendaBookingPersonDisplayName", () => {
  it("prefiere nombre, luego email, luego id", () => {
    assert.equal(
      mesaAgendaBookingPersonDisplayName({
        id: "id-1",
        fullName: "Ana",
        email: "ana@test.c",
      }),
      "Ana",
    );
    assert.equal(
      mesaAgendaBookingPersonDisplayName({
        id: "id-1",
        fullName: null,
        email: "ana@test.c",
      }),
      "ana@test.c",
    );
    assert.equal(
      mesaAgendaBookingPersonDisplayName({
        id: "id-1",
        fullName: null,
        email: null,
      }),
      "id-1",
    );
  });
});
