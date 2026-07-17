import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockAdminProductionRepo } from "./mock.repo";
import { resolveAdminPeriodBounds } from "./period";
import type { ExpedientesRepo } from "@/domain/expedientes/repo";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";
import { formatAdminMesaAsesorLabel } from "./mesa-seguimiento";

function stub(id: string, asesorNombre: string | null): ExpedienteMock {
  return {
    id,
    base: {
      programa: "mejoravit",
      nss: "12345678901",
      cliente_nombre: `Cliente ${id}`,
      telefono_cliente: "8110000000",
      direccion_opcional: "",
      asesorId: "11111111-1111-4111-8111-111111111111",
      asesorNombre,
      asesorEmail: "secreto@example.com",
      createdAt: "2026-07-15T15:00:00.000Z",
      origenMesa: "interno",
    },
    editorDecision: {
      decision: "aprobado",
      monto_aprobado: 30000,
      notas_revision: "",
      aprobadoAt: "2026-07-15T15:00:00.000Z",
      noCumpleAt: null,
      montoAprobadoAlAprobar: 30000,
    },
    operativo: {
      submittedToMesa: true,
      fechaEnvioMesa: "2026-07-15T15:00:00.000Z",
      etapaActual: 2,
      subestado: "en_proceso",
      cicloEstado: "activo",
      updatedAt: "2026-07-15T15:00:00.000Z",
    },
  } as ExpedienteMock;
}

describe("P085 timeline bajo demanda + privacidad asesor", () => {
  it("carga admin no llama timeline; abrir y Cargar más sí", async () => {
    const items = [stub("e1", "Ana"), stub("e2", null)];
    const stubRepo = {
      listForAdmin: async () => items,
    } as unknown as ExpedientesRepo;
    const base = new MockAdminProductionRepo(stubRepo);
    let timelineCalls = 0;
    const repo = {
      getSummary: (f: Parameters<MockAdminProductionRepo["getSummary"]>[0]) =>
        base.getSummary(f),
      getMesaCohortByEtapa: (
        f: Parameters<MockAdminProductionRepo["getMesaCohortByEtapa"]>[0],
      ) => base.getMesaCohortByEtapa(f),
      listByAsesor: (f: Parameters<MockAdminProductionRepo["listByAsesor"]>[0]) =>
        base.listByAsesor(f),
      listMesaEnviosPage: (
        f: Parameters<MockAdminProductionRepo["listMesaEnviosPage"]>[0],
      ) => base.listMesaEnviosPage(f),
      listPrecalificacionesPage: (
        f: Parameters<MockAdminProductionRepo["listPrecalificacionesPage"]>[0],
      ) => base.listPrecalificacionesPage(f),
      getExpedienteMesaTimeline: async (
        input: Parameters<MockAdminProductionRepo["getExpedienteMesaTimeline"]>[0],
      ) => {
        timelineCalls += 1;
        return base.getExpedienteMesaTimeline(input);
      },
      exportAll: (f: Parameters<MockAdminProductionRepo["exportAll"]>[0]) =>
        base.exportAll(f),
    };

    const bounds = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-07-01",
      customToInclusive: "2026-07-31",
    });
    const filters = {
      bounds,
      asesorId: null as string | null,
      etapaActual: null as number | null,
      estado: "todos" as const,
      buscar: null as string | null,
      precalDecision: "resueltas" as const,
    };

    await Promise.all([
      repo.getSummary(filters),
      repo.getMesaCohortByEtapa(filters),
      repo.listByAsesor(filters),
      repo.listMesaEnviosPage({ ...filters, page: 1, pageSize: 25 }),
      repo.listPrecalificacionesPage({ ...filters, page: 1, pageSize: 25 }),
    ]);
    assert.equal(timelineCalls, 0, "cero llamadas al cargar listados");

    const open1 = await repo.getExpedienteMesaTimeline({
      expedienteId: "e1",
      limit: 10,
      offset: 0,
    });
    assert.equal(timelineCalls, 1);
    assert.equal(open1.expedienteId, "e1");

    await repo.getExpedienteMesaTimeline({
      expedienteId: "e1",
      limit: 10,
      offset: 10,
    });
    assert.equal(timelineCalls, 2, "Cargar más = +1");

    const open2 = await repo.getExpedienteMesaTimeline({
      expedienteId: "e2",
      limit: 10,
      offset: 0,
    });
    assert.equal(timelineCalls, 3);
    assert.equal(open2.expedienteId, "e2");
    assert.notEqual(open2.expedienteId, open1.expedienteId);
  });

  it("contrato Mesa no expone correo; fallback sin nombre", async () => {
    const stubRepo = {
      listForAdmin: async () => [stub("e1", null)],
    } as unknown as ExpedientesRepo;
    const repo = new MockAdminProductionRepo(stubRepo);
    const bounds = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-07-01",
      customToInclusive: "2026-07-31",
    });
    const mesa = await repo.listMesaEnviosPage({
      bounds,
      page: 1,
      pageSize: 25,
      estado: "todos",
      asesorId: null,
      etapaActual: null,
      buscar: null,
    });
    const row = mesa.items[0];
    assert.ok(row);
    assert.equal(Object.hasOwn(row, "asesorEmail"), false);
    assert.equal(formatAdminMesaAsesorLabel(row.asesorNombre), "Asesor sin nombre registrado");
    const json = JSON.stringify(row);
    assert.equal(json.includes("@"), false);
    assert.equal(json.toLowerCase().includes("asesoremail"), false);
  });
});
