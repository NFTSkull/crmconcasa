import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isInstantInPeriod,
  isMontoMayorA20000,
  resolveAdminPeriodBounds,
  zonedYmdParts,
  ADMIN_BUSINESS_TIMEZONE,
} from "./period";
import {
  computeAdminProductionSummary,
  groupMesaEnviosByEtapaActual,
  emptyAdminMesaSeguimientoFields,
} from "./metrics";

describe("admin-production period", () => {
  it("hoy usa inicio/fin correctos en America/Monterrey", () => {
    const now = new Date("2026-07-17T18:00:00.000Z");
    const parts = zonedYmdParts(now, ADMIN_BUSINESS_TIMEZONE);
    assert.equal(parts.year, 2026);
    assert.equal(parts.month, 7);
    assert.equal(parts.day, 17);

    const bounds = resolveAdminPeriodBounds({ preset: "hoy", now });
    assert.equal(bounds.fromDate, "2026-07-17");
    assert.equal(bounds.toDateInclusive, "2026-07-17");
    assert.equal(bounds.fromIso < bounds.toExclusiveIso, true);
    assert.equal(isInstantInPeriod("2026-07-17T12:00:00.000Z", bounds), true);
    assert.equal(isInstantInPeriod("2026-07-16T12:00:00.000Z", bounds), false);
  });

  it("esta semana inicia en lunes Monterrey", () => {
    const now = new Date("2026-07-17T18:00:00.000Z");
    const bounds = resolveAdminPeriodBounds({ preset: "semana", now });
    assert.equal(bounds.fromDate, "2026-07-13");
    assert.equal(bounds.toDateInclusive, "2026-07-17");
  });

  it("este mes inicia el día 1", () => {
    const now = new Date("2026-07-17T18:00:00.000Z");
    const bounds = resolveAdminPeriodBounds({ preset: "mes", now });
    assert.equal(bounds.fromDate, "2026-07-01");
    assert.equal(bounds.toDateInclusive, "2026-07-17");
  });

  it("rango personalizado incluye ambos extremos", () => {
    const bounds = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-07-01",
      customToInclusive: "2026-07-10",
    });
    assert.equal(bounds.fromDate, "2026-07-01");
    assert.equal(bounds.toDateInclusive, "2026-07-10");
  });

  it("rango inválido se rechaza", () => {
    assert.throws(() =>
      resolveAdminPeriodBounds({
        preset: "personalizado",
        customFrom: "2026-07-10",
        customToInclusive: "2026-07-01",
      }),
    );
  });

  it("mayor a 20000 es estricto", () => {
    assert.equal(isMontoMayorA20000(20000), false);
    assert.equal(isMontoMayorA20000(20000.01), true);
  });
});

describe("admin-production metrics", () => {
  it("solo cuenta enviados y aprobaciones/rechazos del periodo con fechas canónicas", () => {
    const bounds = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-07-01",
      customToInclusive: "2026-07-31",
    });
    const summary = computeAdminProductionSummary({
      bounds,
      mesaEnvios: [
        {
          expedienteId: "a",
          fechaEnvioMesa: "2026-07-05T15:00:00.000Z",
          clienteNombre: "A",
          asesorId: "as1",
          asesorNombre: "Uno",
          etapaActual: 9,
          subestado: "en_proceso",
          cicloEstado: "activo",
          programa: "mejoravit",
          ...emptyAdminMesaSeguimientoFields("2026-07-05T15:00:00.000Z"),
        },
        {
          expedienteId: "b",
          fechaEnvioMesa: "2026-06-01T15:00:00.000Z",
          clienteNombre: "B",
          asesorId: "as1",
          asesorNombre: "Uno",
          etapaActual: 2,
          subestado: "en_proceso",
          cicloEstado: "activo",
          programa: "mejoravit",
          ...emptyAdminMesaSeguimientoFields("2026-06-01T15:00:00.000Z"),
        },
      ],
      precalRows: [
        {
          expedienteId: "a",
          fecha: "2026-07-02T15:00:00.000Z",
          aprobadoAt: "2026-07-02T15:00:00.000Z",
          noCumpleAt: null,
          clienteNombre: "A",
          asesorId: "as1",
          asesorNombre: "Uno",
          asesorEmail: null,
          decision: "aprobado",
          montoAprobadoAlAprobar: 15000,
          montoAprobadoActual: 15000,
          programa: "mejoravit",
        },
        {
          expedienteId: "c",
          fecha: "2026-07-03T15:00:00.000Z",
          aprobadoAt: "2026-07-03T15:00:00.000Z",
          noCumpleAt: null,
          clienteNombre: "C",
          asesorId: "as2",
          asesorNombre: "Dos",
          asesorEmail: null,
          decision: "aprobado",
          montoAprobadoAlAprobar: 30000,
          montoAprobadoActual: 30000,
          programa: "mejoravit",
        },
        {
          expedienteId: "d",
          fecha: "2026-07-04T15:00:00.000Z",
          aprobadoAt: null,
          noCumpleAt: "2026-07-04T15:00:00.000Z",
          clienteNombre: "D",
          asesorId: "as2",
          asesorNombre: "Dos",
          asesorEmail: null,
          decision: "no_cumple",
          montoAprobadoAlAprobar: null,
          montoAprobadoActual: null,
          programa: "mejoravit",
        },
        {
          expedienteId: "e",
          fecha: "2026-07-05T15:00:00.000Z",
          aprobadoAt: "2026-07-05T15:00:00.000Z",
          noCumpleAt: null,
          clienteNombre: "E",
          asesorId: "as2",
          asesorNombre: "Dos",
          asesorEmail: null,
          decision: "aprobado",
          montoAprobadoAlAprobar: 40000,
          montoAprobadoActual: 40000,
          programa: "compro_tu_casa",
        },
      ],
    });

    assert.equal(summary.enviadosAMesa, 1);
    assert.equal(summary.precalificacionesAprobadas, 3);
    assert.equal(summary.precalificacionesNoCumple, 1);
    assert.equal(summary.aprobadasMayorA20000, 2);
    assert.equal(summary.montoAprobadoTotal, 45000);
  });

  it("agrupa estado actual por etapa de la cohorte", () => {
    const groups = groupMesaEnviosByEtapaActual([
      {
        expedienteId: "a",
        fechaEnvioMesa: "2026-07-05T15:00:00.000Z",
        clienteNombre: "A",
        asesorId: "as1",
        asesorNombre: null,
        etapaActual: 9,
        subestado: "en_proceso",
        cicloEstado: "activo",
        programa: "mejoravit",
        ...emptyAdminMesaSeguimientoFields("2026-07-05T15:00:00.000Z"),
      },
      {
        expedienteId: "b",
        fechaEnvioMesa: "2026-07-06T15:00:00.000Z",
        clienteNombre: "B",
        asesorId: "as1",
        asesorNombre: null,
        etapaActual: 9,
        subestado: "en_proceso",
        cicloEstado: "activo",
        programa: "mejoravit",
        ...emptyAdminMesaSeguimientoFields("2026-07-06T15:00:00.000Z"),
      },
    ]);
    assert.equal(groups[8]?.etapa, 9);
    assert.equal(groups[8]?.count, 2);
    assert.equal(groups[8]?.pct, 100);
  });
});
