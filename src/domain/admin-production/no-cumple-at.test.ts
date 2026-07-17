import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeAdminProductionSummary,
  computePrecalMontosMejoravit,
  isMontoMayorA20000,
  isProgramaMejoravit,
  labelEditorDecision,
  nextNoCumpleAt,
  resolvePrecalVisibleFecha,
  type AdminPrecalEvent,
} from "./metrics";
import { resolveAdminPeriodBounds } from "./period";

const bounds = resolveAdminPeriodBounds({
  preset: "personalizado",
  customFrom: "2026-07-17",
  customToInclusive: "2026-07-17",
  now: new Date("2026-07-17T18:00:00.000Z"),
});

function row(partial: Partial<AdminPrecalEvent> & Pick<AdminPrecalEvent, "expedienteId" | "decision">): AdminPrecalEvent {
  return {
    fecha: partial.fecha ?? null,
    aprobadoAt: partial.aprobadoAt ?? null,
    noCumpleAt: partial.noCumpleAt ?? null,
    clienteNombre: partial.clienteNombre ?? "X",
    asesorId: partial.asesorId ?? "as1",
    asesorNombre: partial.asesorNombre ?? null,
    asesorEmail: partial.asesorEmail ?? null,
    montoAprobadoAlAprobar: partial.montoAprobadoAlAprobar ?? null,
    montoAprobadoActual: partial.montoAprobadoActual ?? null,
    programa: partial.programa ?? "mejoravit",
    ...partial,
  };
}

describe("P083 no_cumple_at semántica", () => {
  it("1. primera transición a no_cumple fija fecha", () => {
    assert.equal(
      nextNoCumpleAt({
        prevDecision: "pendiente",
        nextDecision: "no_cumple",
        prevNoCumpleAt: null,
        nowIso: "2026-07-17T12:00:00.000Z",
      }),
      "2026-07-17T12:00:00.000Z",
    );
  });

  it("2. repetir no_cumple no cambia la fecha", () => {
    assert.equal(
      nextNoCumpleAt({
        prevDecision: "no_cumple",
        nextDecision: "no_cumple",
        prevNoCumpleAt: "2026-07-10T12:00:00.000Z",
        nowIso: "2026-07-17T12:00:00.000Z",
      }),
      "2026-07-10T12:00:00.000Z",
    );
  });

  it("3-4. editar monto/notas no cambia (misma decisión)", () => {
    assert.equal(
      nextNoCumpleAt({
        prevDecision: "no_cumple",
        nextDecision: "no_cumple",
        prevNoCumpleAt: "2026-07-10T12:00:00.000Z",
        nowIso: "2026-07-17T18:00:00.000Z",
      }),
      "2026-07-10T12:00:00.000Z",
    );
  });

  it("5. no_cumple → aprobado conserva fecha de rechazo", () => {
    assert.equal(
      nextNoCumpleAt({
        prevDecision: "no_cumple",
        nextDecision: "aprobado",
        prevNoCumpleAt: "2026-07-10T12:00:00.000Z",
        nowIso: "2026-07-17T12:00:00.000Z",
      }),
      "2026-07-10T12:00:00.000Z",
    );
  });

  it("6. aprobado → no_cumple fija si estaba null", () => {
    assert.equal(
      nextNoCumpleAt({
        prevDecision: "aprobado",
        nextDecision: "no_cumple",
        prevNoCumpleAt: null,
        nowIso: "2026-07-17T12:00:00.000Z",
      }),
      "2026-07-17T12:00:00.000Z",
    );
  });

  it("7. no_cumple → aprobado → no_cumple no sobrescribe", () => {
    assert.equal(
      nextNoCumpleAt({
        prevDecision: "aprobado",
        nextDecision: "no_cumple",
        prevNoCumpleAt: "2026-07-01T08:00:00.000Z",
        nowIso: "2026-07-17T12:00:00.000Z",
      }),
      "2026-07-01T08:00:00.000Z",
    );
  });

  it("8-9. sin transición no inventa fecha", () => {
    assert.equal(
      nextNoCumpleAt({
        prevDecision: "pendiente",
        nextDecision: "pendiente",
        prevNoCumpleAt: null,
        nowIso: "2026-07-17T12:00:00.000Z",
      }),
      null,
    );
  });
});

describe("P083 Admin fechas canónicas y montos", () => {
  it("10-12. rechazos usan no_cumple_at; aprobadas aprobado_at; no updated_at", () => {
    assert.equal(
      resolvePrecalVisibleFecha({
        decision: "no_cumple",
        aprobadoAt: "2026-07-01T00:00:00.000Z",
        noCumpleAt: "2026-07-17T10:00:00.000Z",
      }),
      "2026-07-17T10:00:00.000Z",
    );
    assert.equal(
      resolvePrecalVisibleFecha({
        decision: "aprobado",
        aprobadoAt: "2026-07-17T09:00:00.000Z",
        noCumpleAt: "2026-07-01T00:00:00.000Z",
      }),
      "2026-07-17T09:00:00.000Z",
    );
    assert.equal(
      resolvePrecalVisibleFecha({
        decision: "pendiente",
        aprobadoAt: null,
        noCumpleAt: null,
      }),
      null,
    );
  });

  it("13-16. monto solo Mejoravit aprobado; 20000 no entra en >20k", () => {
    const summary = computeAdminProductionSummary({
      bounds,
      mesaEnvios: [],
      precalRows: [
        row({
          expedienteId: "a",
          decision: "aprobado",
          aprobadoAt: "2026-07-17T12:00:00.000Z",
          montoAprobadoAlAprobar: 30000,
          programa: "mejoravit",
        }),
        row({
          expedienteId: "b",
          decision: "no_cumple",
          noCumpleAt: "2026-07-17T12:00:00.000Z",
          montoAprobadoAlAprobar: 50000,
          programa: "mejoravit",
        }),
        row({
          expedienteId: "c",
          decision: "aprobado",
          aprobadoAt: "2026-07-17T12:00:00.000Z",
          montoAprobadoAlAprobar: 90000,
          programa: "compro_tu_casa",
        }),
        row({
          expedienteId: "d",
          decision: "aprobado",
          aprobadoAt: "2026-07-17T12:00:00.000Z",
          montoAprobadoAlAprobar: 20000,
          programa: "mejoravit",
        }),
      ],
    });
    assert.equal(summary.precalificacionesAprobadas, 3);
    assert.equal(summary.precalificacionesNoCumple, 1);
    assert.equal(summary.montoAprobadoTotal, 50000);
    assert.equal(summary.aprobadasMayorA20000, 2);
    assert.equal(isMontoMayorA20000(20000), false);
    assert.equal(isProgramaMejoravit("mejoravit"), true);

    const montos = computePrecalMontosMejoravit([
      row({
        expedienteId: "b",
        decision: "no_cumple",
        noCumpleAt: "2026-07-17T12:00:00.000Z",
        montoAprobadoAlAprobar: 50000,
        programa: "mejoravit",
      }),
    ]);
    assert.equal(montos.montoAprobadoTotal, 0);
  });

  it("17-18. etiquetas y fechas visibles correctas", () => {
    assert.equal(labelEditorDecision("aprobado"), "Aprobada");
    assert.equal(labelEditorDecision("no_cumple"), "Rechazada (No cumple)");
    assert.equal(labelEditorDecision("pendiente"), "Pendiente actual");
  });
});
