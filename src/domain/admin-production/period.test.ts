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
} from "./metrics";

describe("admin-production period", () => {
  it("hoy usa inicio/fin correctos en America/Monterrey", () => {
    // 2026-07-17 15:00 UTC = mediodía Monterrey aprox CDT (UTC-5)
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
    const now = new Date("2026-07-17T18:00:00.000Z"); // viernes
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
      customToInclusive: "2026-07-17",
    });
    assert.equal(bounds.fromDate, "2026-07-01");
    assert.equal(bounds.toDateInclusive, "2026-07-17");
    assert.equal(isInstantInPeriod(bounds.fromIso, bounds), true);
    // instante justo en el to exclusivo queda fuera
    assert.equal(isInstantInPeriod(bounds.toExclusiveIso, bounds), false);
  });

  it("rango inválido se rechaza", () => {
    assert.throws(() =>
      resolveAdminPeriodBounds({
        preset: "personalizado",
        customFrom: "2026-07-20",
        customToInclusive: "2026-07-10",
      }),
    );
    assert.throws(() =>
      resolveAdminPeriodBounds({
        preset: "personalizado",
        customFrom: "nope",
        customToInclusive: "2026-07-10",
      }),
    );
  });

  it("mayor a 20000 es estricto", () => {
    assert.equal(isMontoMayorA20000(20000), false);
    assert.equal(isMontoMayorA20000(20000.01), true);
    assert.equal(isMontoMayorA20000(19999.99), false);
  });
});

describe("admin-production metrics", () => {
  const bounds = resolveAdminPeriodBounds({
    preset: "personalizado",
    customFrom: "2026-07-01",
    customToInclusive: "2026-07-17",
  });

  it("solo cuenta enviados y aprobaciones del periodo con monto al aprobar", () => {
    const summary = computeAdminProductionSummary({
      bounds,
      mesaEnvios: [
        {
          expedienteId: "a",
          fechaEnvioMesa: "2026-07-05T15:00:00.000Z",
          clienteNombre: "A",
          asesorId: "as1",
          asesorNombre: "Uno",
          asesorEmail: null,
          etapaActual: 9,
          subestado: "en_proceso",
          cicloEstado: "activo",
          programa: "mejoravit",
          montoAprobadoActual: 50000,
          montoAprobadoAlAprobar: 25000,
          updatedAt: null,
        },
        {
          expedienteId: "b",
          fechaEnvioMesa: "2026-06-01T15:00:00.000Z",
          clienteNombre: "B",
          asesorId: "as1",
          asesorNombre: "Uno",
          asesorEmail: null,
          etapaActual: 2,
          subestado: "en_proceso",
          cicloEstado: "activo",
          programa: "mejoravit",
          montoAprobadoActual: null,
          montoAprobadoAlAprobar: null,
          updatedAt: null,
        },
      ],
      precalAprobadas: [
        {
          expedienteId: "a",
          aprobadoAt: "2026-07-02T15:00:00.000Z",
          clienteNombre: "A",
          asesorId: "as1",
          asesorNombre: "Uno",
          asesorEmail: null,
          decision: "aprobado",
          montoAprobadoAlAprobar: 25000,
          montoAprobadoActual: 50000,
          programa: "mejoravit",
        },
        {
          expedienteId: "c",
          aprobadoAt: "2026-07-03T15:00:00.000Z",
          clienteNombre: "C",
          asesorId: "as2",
          asesorNombre: "Dos",
          asesorEmail: null,
          decision: "aprobado",
          montoAprobadoAlAprobar: 20000,
          montoAprobadoActual: 20000,
          programa: "mejoravit",
        },
      ],
    });

    assert.equal(summary.enviadosAMesa, 1);
    assert.equal(summary.precalificacionesAprobadas, 2);
    assert.equal(summary.aprobadasMayorA20000, 1);
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
        asesorEmail: null,
        etapaActual: 9,
        subestado: "en_proceso",
        cicloEstado: "activo",
        programa: "mejoravit",
        montoAprobadoActual: null,
        montoAprobadoAlAprobar: null,
        updatedAt: null,
      },
      {
        expedienteId: "b",
        fechaEnvioMesa: "2026-07-06T15:00:00.000Z",
        clienteNombre: "B",
        asesorId: "as1",
        asesorNombre: null,
        asesorEmail: null,
        etapaActual: 9,
        subestado: "en_proceso",
        cicloEstado: "activo",
        programa: "mejoravit",
        montoAprobadoActual: null,
        montoAprobadoAlAprobar: null,
        updatedAt: null,
      },
    ]);
    assert.equal(groups[8]?.etapa, 9);
    assert.equal(groups[8]?.count, 2);
    assert.equal(groups[8]?.pct, 100);
  });
});
