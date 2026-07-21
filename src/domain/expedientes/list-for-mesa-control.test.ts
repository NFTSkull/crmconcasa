import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExpedienteMock } from "./mock.repo";

function baseExp(partial: Partial<ExpedienteMock> & Pick<ExpedienteMock, "id">): ExpedienteMock {
  return {
    id: partial.id,
    base: {
      programa: "Mejoravit",
      nss: "12345678901",
      cliente_nombre: "Cliente",
      telefono_cliente: "5512345678",
      direccion_opcional: "",
      asesorId: "asesor@test.com",
      createdAt: "2026-01-01T00:00:00.000Z",
      origenMesa: "interno",
      ...partial.base,
    },
    editorDecision: {
      decision: "aprobado",
      monto_aprobado: 100000,
      notas_revision: "",
      ...partial.editorDecision,
    },
    operativo: {
      etapaActual: 1,
      subestado: "en_validacion_mesa",
      motivoRechazo: null,
      comentarioRechazo: null,
      fechaCita: null,
      updatedAt: "2026-01-02T00:00:00.000Z",
      submittedToMesa: true,
      fechaEnvioMesa: "2026-01-02T00:00:00.000Z",
      cicloEstado: "activo",
      ...partial.operativo,
    },
  };
}

/** Espejo del filtro de `MockExpedientesRepo.listForMesaControl`. */
function filterListForMesaControl(items: ExpedienteMock[]): ExpedienteMock[] {
  return items
    .filter((e) => e.operativo.submittedToMesa)
    .filter((e) => {
      const ciclo = e.operativo.cicloEstado;
      return ciclo == null || ciclo === "activo" || ciclo === "cancelado";
    });
}

describe("listForMesaControl (filtro mock)", () => {
  it("incluye enviados a mesa con ciclo activo, cancelado o sin ciclo", () => {
    const items = [
      baseExp({ id: "a" }),
      baseExp({
        id: "b",
        operativo: { ...baseExp({ id: "x" }).operativo, cicloEstado: null },
      }),
      baseExp({
        id: "c",
        operativo: { ...baseExp({ id: "x" }).operativo, submittedToMesa: false },
      }),
      baseExp({
        id: "d",
        operativo: { ...baseExp({ id: "x" }).operativo, cicloEstado: "cerrado" },
      }),
      baseExp({
        id: "e",
        operativo: {
          ...baseExp({ id: "x" }).operativo,
          cicloEstado: "cancelado",
        },
      }),
    ];
    const out = filterListForMesaControl(items);
    assert.deepEqual(
      out.map((x) => x.id),
      ["a", "b", "e"],
    );
  });
});
