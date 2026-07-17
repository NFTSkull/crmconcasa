import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockAdminProductionRepo } from "./mock.repo";
import { resolveAdminPeriodBounds } from "./period";
import type { ExpedientesRepo } from "@/domain/expedientes/repo";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";

function stubExpediente(partial: {
  id: string;
  asesorId: string;
  asesorNombre: string;
  fechaEnvioMesa: string;
  etapaActual?: number;
  decision?: "pendiente" | "aprobado" | "no_cumple";
  aprobadoAt?: string | null;
  montoAlAprobar?: number | null;
}): ExpedienteMock {
  return {
    id: partial.id,
    base: {
      programa: "mejoravit",
      nss: "12345678901",
      cliente_nombre: `Cliente ${partial.id}`,
      telefono_cliente: "8110000000",
      direccion_opcional: "",
      asesorId: partial.asesorId,
      asesorNombre: partial.asesorNombre,
      asesorEmail: `${partial.asesorId}@example.com`,
      createdAt: partial.fechaEnvioMesa,
      origenMesa: "interno",
    },
    editorDecision: {
      decision: partial.decision ?? "aprobado",
      monto_aprobado: partial.montoAlAprobar ?? 30000,
      notas_revision: "",
      aprobadoAt: partial.aprobadoAt ?? partial.fechaEnvioMesa,
      noCumpleAt: null,
      montoAprobadoAlAprobar: partial.montoAlAprobar ?? 30000,
    },
    operativo: {
      submittedToMesa: true,
      fechaEnvioMesa: partial.fechaEnvioMesa,
      etapaActual: partial.etapaActual ?? 2,
      subestado: "en_proceso",
      cicloEstado: "activo",
      updatedAt: partial.fechaEnvioMesa,
    },
  } as ExpedienteMock;
}

describe("filtro global asesor UUID — propagación completa", () => {
  it("KPIs, etapas, producción, mesa, precal y Excel usan el mismo UUID", async () => {
    const a1 = "11111111-1111-4111-8111-111111111111";
    const a2 = "22222222-2222-4222-8222-222222222222";
    const items = [
      stubExpediente({
        id: "e1",
        asesorId: a1,
        asesorNombre: "Sandra Alvarez",
        fechaEnvioMesa: "2026-07-15T15:00:00.000Z",
        etapaActual: 2,
      }),
      stubExpediente({
        id: "e2",
        asesorId: a2,
        asesorNombre: "Otro Asesor",
        fechaEnvioMesa: "2026-07-15T16:00:00.000Z",
        etapaActual: 5,
      }),
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
    const filters = {
      bounds,
      asesorId: a1,
      etapaActual: null as number | null,
      estado: "todos" as const,
      buscar: null as string | null,
      precalDecision: "resueltas" as const,
    };

    const [summary, cohort, asesores, mesa, precal, excel] = await Promise.all([
      repo.getSummary(filters),
      repo.getMesaCohortByEtapa(filters),
      repo.listByAsesor(filters),
      repo.listMesaEnviosPage({ ...filters, page: 1, pageSize: 25 }),
      repo.listPrecalificacionesPage({ ...filters, page: 1, pageSize: 25 }),
      repo.exportAll(filters),
    ]);

    assert.equal(summary.enviadosAMesa, 1);
    assert.equal(asesores.length, 1);
    assert.equal(asesores[0]?.asesorId, a1);
    assert.equal(mesa.totalCount, 1);
    assert.equal(mesa.items[0]?.asesorId, a1);
    assert.ok(mesa.items.every((r) => r.situacionLabel.length > 0));
    assert.equal(precal.totalCount, 1);
    assert.equal(precal.items[0]?.asesorId, a1);
    assert.equal(excel.asesores.length, 1);
    assert.equal(excel.mesaEnvios.length, 1);
    assert.equal(excel.precalificaciones.length, 1);
    assert.equal(excel.summary.enviadosAMesa, 1);

    const etapa2 = cohort.byEtapa.find((b) => b.etapa === 2);
    const etapa5 = cohort.byEtapa.find((b) => b.etapa === 5);
    assert.equal(etapa2?.count ?? 0, 1);
    assert.equal(etapa5?.count ?? 0, 0);

    // No filtra por nombre/email: UUID ajeno → vacío
    const missing = await repo.listByAsesor({
      ...filters,
      asesorId: "33333333-3333-4333-8333-333333333333",
    });
    assert.equal(missing.length, 0);

    const timeline = await repo.getExpedienteMesaTimeline({ expedienteId: "e1" });
    assert.ok(timeline.items.length >= 1);
    assert.equal(timeline.items[0]?.action, "expediente.enviar_a_mesa");
  });
});
