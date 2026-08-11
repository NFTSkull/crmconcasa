import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupByDayCitas,
  groupByDayIngresos,
  sortCitasByTimeAsc,
  sortIngresosDesc,
  type BernardoCitaRow,
} from "@/lib/adminBernardoLoad";
import {
  emptyAdminMesaSeguimientoFields,
  type AdminMesaEnvioEvent,
} from "@/domain/admin-production";

function mesa(
  partial: Pick<AdminMesaEnvioEvent, "expedienteId" | "fechaEnvioMesa" | "clienteNombre">,
): AdminMesaEnvioEvent {
  return {
    ...emptyAdminMesaSeguimientoFields(partial.fechaEnvioMesa),
    asesorId: "a1",
    asesorNombre: "Ana",
    programa: "mejoravit",
    etapaActual: 2,
    subestado: "",
    cicloEstado: "activo",
    ...partial,
  };
}

function cita(
  partial: Partial<BernardoCitaRow> &
    Pick<BernardoCitaRow, "bookingId" | "bookingDate" | "bookingTime">,
): BernardoCitaRow {
  return {
    expedienteId: "e1",
    resultId: "r1",
    clienteNombre: "Cliente",
    asesorNombre: "Asesor",
    status: "completed",
    statusLabel: "Completado",
    resultClass: "COMPLETED",
    resultRaw: "CESI MTY",
    locationId: "monterrey",
    sheetRow: 25,
    etapaActual: 4,
    etapaLabel: "Biométricos",
    kind: "biometricos",
    ...partial,
  };
}

describe("Admin UX B3 — agrupación y orden Bernardo", () => {
  it("ingresos ordena por fecha descendente y agrupa por día", () => {
    const items = [
      mesa({
        expedienteId: "1",
        fechaEnvioMesa: "2026-08-05T10:00:00.000Z",
        clienteNombre: "A",
      }),
      mesa({
        expedienteId: "2",
        fechaEnvioMesa: "2026-08-04T12:00:00.000Z",
        clienteNombre: "B",
      }),
      mesa({
        expedienteId: "3",
        fechaEnvioMesa: "2026-08-05T18:00:00.000Z",
        clienteNombre: "C",
      }),
    ];
    const sorted = sortIngresosDesc(items);
    assert.equal(sorted[0]?.clienteNombre, "C");
    const groups = groupByDayIngresos(items);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.date, "2026-08-05");
    assert.equal(groups[0]?.items.length, 2);
  });

  it("citas ordenan por hora y agrupan por día", () => {
    const items = [
      cita({ bookingId: "1", bookingDate: "2026-08-05", bookingTime: "11:00" }),
      cita({ bookingId: "2", bookingDate: "2026-08-05", bookingTime: "09:00" }),
      cita({ bookingId: "3", bookingDate: "2026-08-04", bookingTime: "15:00" }),
    ];
    const sorted = sortCitasByTimeAsc(items);
    assert.equal(sorted[0]?.bookingId, "3");
    assert.equal(sorted[1]?.bookingId, "2");
    const groups = groupByDayCitas(items);
    assert.equal(groups[0]?.date, "2026-08-05");
    assert.equal(groups[0]?.items[0]?.bookingTime, "09:00");
  });
});
