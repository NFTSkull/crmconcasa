import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMesaBandejaFirstPaint } from "./mesaBandejaFirstPaint";

describe("buildMesaBandejaFirstPaint", () => {
  it("pinta como nueva desde la respuesta primaria sin esperar enrich", () => {
    const hints = buildMesaBandejaFirstPaint({
      expedienteId: "00000000-0000-4000-8000-000000000001",
      fechaEnvioMesa: "2026-09-10T12:00:00.000Z",
      createdAt: "2026-09-10T11:00:00.000Z",
      categoriaResumen: "pendiente_revision_documental",
      opsHint: {
        estadoMesa: "en_trabajo",
        assignedTo: "00000000-0000-4000-8000-000000000002",
        assignedAt: "2026-09-10T12:01:00.000Z",
        lastActivityAt: "2026-09-10T12:02:00.000Z",
      },
      mesaUserId: "00000000-0000-4000-8000-000000000003",
      lastOpenedAt: null,
    });

    assert.equal(hints.correccionLecturaEstado, "nueva");
    assert.equal(hints.fechaEntradaMesaActual, "2026-09-10T12:00:00.000Z");
    assert.equal(hints.entradaLecturaEsCorreccion, false);
    assert.equal(hints.resumenDocumental, "pendiente_revision_documental");
    assert.deepEqual(hints.mesaOps, {
      expedienteId: "00000000-0000-4000-8000-000000000001",
      assignedTo: "00000000-0000-4000-8000-000000000002",
      assignedToName: null,
      assignedAt: "2026-09-10T12:01:00.000Z",
      estadoMesa: "en_trabajo",
      lastActivityAt: "2026-09-10T12:02:00.000Z",
    });
  });

  it("usa cambioActionableAt como entrada actual y reconoce corrección", () => {
    const hints = buildMesaBandejaFirstPaint({
      expedienteId: "00000000-0000-4000-8000-000000000010",
      fechaEnvioMesa: "2026-09-01T12:00:00.000Z",
      createdAt: "2026-09-01T11:00:00.000Z",
      cambioActionableAt: "2026-09-10T15:30:00.000Z",
      categoriaResumen: "correccion_enviada",
      lastOpenedAt: "2026-09-09T15:30:00.000Z",
    });

    assert.equal(hints.fechaEntradaMesaActual, "2026-09-10T15:30:00.000Z");
    assert.equal(hints.entradaLecturaEsCorreccion, true);
    assert.equal(hints.correccionLecturaEstado, "nueva");
    assert.equal(hints.resumenDocumental, "correccion_enviada");
  });

  it("sale abierta desde first paint si el usuario ya abrió la entrada actual", () => {
    const hints = buildMesaBandejaFirstPaint({
      expedienteId: "00000000-0000-4000-8000-000000000020",
      fechaEnvioMesa: "2026-09-10T12:00:00.000Z",
      createdAt: "2026-09-10T11:00:00.000Z",
      lastOpenedAt: "2026-09-10T12:05:00.000Z",
    });

    assert.equal(hints.correccionLecturaEstado, "abierta");
    assert.equal(hints.mesaOps, null);
  });
});
