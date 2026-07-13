import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertCalendarDateRange } from "@/lib/asesorAgendaCalendar";
import {
  buildMesaAgendaBookingsRpcPayload,
  MesaAgendaBookingsSupabaseError,
} from "./mesa.repo";

describe("buildMesaAgendaBookingsRpcPayload", () => {
  it("arma payload RPC con kind null por defecto", () => {
    const payload = buildMesaAgendaBookingsRpcPayload({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      includeCancelled: false,
    });
    assert.deepEqual(payload, {
      p_start_date: "2026-07-01",
      p_end_date: "2026-07-31",
      p_include_cancelled: false,
      p_kind: null,
    });
  });

  it("pasa filtro de kind cuando se indica", () => {
    const payload = buildMesaAgendaBookingsRpcPayload({
      startDate: "2026-07-10",
      endDate: "2026-07-10",
      includeCancelled: true,
      kind: "notificacion",
    });
    assert.equal(payload.p_kind, "notificacion");
    assert.equal(payload.p_include_cancelled, true);
  });
});

describe("fetchMesaAgendaBookings precondiciones", () => {
  it("rechaza rango inválido antes de llamar Supabase", () => {
    assert.throws(
      () => assertCalendarDateRange("2026-07-10", "2026-07-01"),
      (err: unknown) => err instanceof Error && err.message.includes("inválido"),
    );
  });

  it("rechaza rango mayor a 62 días", () => {
    assert.throws(
      () => assertCalendarDateRange("2026-07-01", "2026-09-15"),
      (err: unknown) => err instanceof Error && err.message.includes("62"),
    );
  });
});

describe("MesaAgendaBookingsSupabaseError", () => {
  it("expone clase de error del repositorio", () => {
    const err = new MesaAgendaBookingsSupabaseError("prueba");
    assert.equal(err.name, "MesaAgendaBookingsSupabaseError");
    assert.equal(err.message, "prueba");
  });
});
