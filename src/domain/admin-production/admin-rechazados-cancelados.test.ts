import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockAdminProductionRepo } from "./mock.repo";
import { resolveAdminPeriodBounds } from "./period";
import type { ExpedientesRepo } from "@/domain/expedientes/repo";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";

function stubMesa(partial: {
  id: string;
  subestado: "rechazado" | "en_proceso";
  cicloEstado: "activo" | "cancelado";
}): ExpedienteMock {
  return {
    id: partial.id,
    base: {
      programa: "mejoravit",
      nss: "12345678901",
      cliente_nombre: `Cliente ${partial.id}`,
      telefono_cliente: "8110000000",
      direccion_opcional: "",
      asesorId: "11111111-1111-4111-8111-111111111111",
      asesorNombre: "Asesor",
      asesorEmail: "a@example.com",
      createdAt: "2026-07-10T12:00:00.000Z",
      origenMesa: "interno",
    },
    editorDecision: {
      decision: "aprobado",
      monto_aprobado: 30000,
      notas_revision: "",
      aprobadoAt: "2026-07-10T12:00:00.000Z",
      noCumpleAt: null,
      montoAprobadoAlAprobar: 30000,
    },
    operativo: {
      submittedToMesa: true,
      fechaEnvioMesa: "2026-07-15T15:00:00.000Z",
      etapaActual: 5,
      subestado: partial.subestado,
      cicloEstado: partial.cicloEstado,
      motivoRechazo: partial.subestado === "rechazado" ? "Docs" : null,
      comentarioRechazo: null,
      fechaCita: null,
      updatedAt: "2026-07-15T15:00:00.000Z",
    },
  } as ExpedienteMock;
}

describe("admin mock — P094 rechazados vs cancelados", () => {
  it("filtro rechazados no mezcla cancelados", async () => {
    const items = [
      stubMesa({ id: "r1", subestado: "rechazado", cicloEstado: "activo" }),
      stubMesa({ id: "c1", subestado: "en_proceso", cicloEstado: "cancelado" }),
      stubMesa({ id: "c2", subestado: "rechazado", cicloEstado: "cancelado" }),
    ];
    const stubRepo = {
      listForAdmin: async () => items,
    } as unknown as ExpedientesRepo;
    const repo = new MockAdminProductionRepo(stubRepo);
    const bounds = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-07-01",
      customToInclusive: "2026-07-31",
    });
    const rechazados = await repo.listMesaEnviosPage({
      bounds,
      estado: "rechazados",
      page: 1,
      pageSize: 25,
    });
    const cancelados = await repo.listMesaEnviosPage({
      bounds,
      estado: "cancelados",
      page: 1,
      pageSize: 25,
    });
    assert.equal(rechazados.totalCount, 1);
    assert.equal(rechazados.items[0]?.expedienteId, "r1");
    assert.equal(cancelados.totalCount, 2);
    assert.deepEqual(
      cancelados.items.map((i) => i.expedienteId).sort(),
      ["c1", "c2"],
    );
    assert.equal(
      cancelados.items.every((i) => i.situacionCode === "cancelado_operativo"),
      true,
    );
    assert.equal(
      cancelados.items.every((i) => i.rechazoOperativo === false),
      true,
    );
  });
});
