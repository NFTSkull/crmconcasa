import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockAdminProductionRepo } from "./mock.repo";
import { resolveAdminPeriodBounds } from "./period";
import type { ExpedientesRepo } from "@/domain/expedientes/repo";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";

function stub(partial: {
  id: string;
  asesorId?: string;
  cliente?: string;
  fechaEnvioMesa?: string | null;
  submittedToMesa?: boolean;
  etapaActual: number;
  reingresoManualCount?: number;
}): ExpedienteMock {
  const asesorId = partial.asesorId ?? "11111111-1111-4111-8111-111111111111";
  const fecha = partial.fechaEnvioMesa ?? null;
  return {
    id: partial.id,
    base: {
      programa: "mejoravit",
      nss: "12345678901",
      cliente_nombre: partial.cliente ?? `Cliente ${partial.id}`,
      telefono_cliente: "8110000000",
      direccion_opcional: "",
      asesorId,
      asesorNombre: "Asesor Snapshot",
      asesorEmail: `${asesorId}@example.com`,
      createdAt: "2026-01-01T15:00:00.000Z",
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
      submittedToMesa: partial.submittedToMesa ?? Boolean(fecha),
      fechaEnvioMesa: fecha,
      etapaActual: partial.etapaActual,
      subestado: "en_proceso",
      cicloEstado: "activo",
      updatedAt: "2026-07-15T15:00:00.000Z",
      reingresoManualCount: partial.reingresoManualCount ?? 0,
    },
  } as unknown as ExpedienteMock;
}

describe("Admin snapshot etapas (independiente del periodo)", () => {
  it("incluye no enviados y antiguos; KPI periodo solo enviados del rango", async () => {
    const hoy = "2026-07-22T18:00:00.000Z";
    const mesAtras = "2026-06-15T18:00:00.000Z";
    const items = [
      stub({ id: "e-hoy", fechaEnvioMesa: hoy, etapaActual: 2 }),
      stub({ id: "e-mes", fechaEnvioMesa: mesAtras, etapaActual: 8 }),
      stub({
        id: "e-sin",
        fechaEnvioMesa: null,
        submittedToMesa: false,
        etapaActual: 1,
      }),
      stub({ id: "e-11", fechaEnvioMesa: "2026-03-01T18:00:00.000Z", etapaActual: 11 }),
      stub({ id: "e-legacy4", fechaEnvioMesa: mesAtras, etapaActual: 4 }),
      stub({
        id: "e-manual",
        fechaEnvioMesa: hoy,
        etapaActual: 2,
        reingresoManualCount: 2,
        cliente: "Reingreso Manual",
      }),
    ];
    const repo = new MockAdminProductionRepo({
      listForAdmin: async () => items,
    } as unknown as ExpedientesRepo);

    const boundsHoy = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-07-22",
      customToInclusive: "2026-07-22",
    });
    const boundsMes = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-07-01",
      customToInclusive: "2026-07-31",
    });

    const summaryHoy = await repo.getSummary({
      bounds: boundsHoy,
      estado: "todos",
    });
    const summaryMes = await repo.getSummary({
      bounds: boundsMes,
      estado: "todos",
    });
    assert.equal(summaryHoy.enviadosAMesa, 2, "KPI hoy: enviados del día");
    assert.ok(summaryMes.enviadosAMesa >= summaryHoy.enviadosAMesa);

    const snapA = await repo.getExpedientesSnapshotEtapas({ estado: "todos" });
    const snapB = await repo.getExpedientesSnapshotEtapas({ estado: "todos" });
    assert.equal(snapA.totalActual, 6);
    assert.equal(snapB.totalActual, snapA.totalActual, "periodo no afecta snapshot");
    assert.equal(
      snapA.byEtapa.reduce((a, b) => a + b.count, 0),
      snapA.totalActual,
    );
    assert.equal(snapA.byEtapa.find((b) => b.etapa === 1)?.count, 1);
    assert.equal(snapA.byEtapa.find((b) => b.etapa === 4)?.count, 1);
    assert.ok((snapA.byPasoVisual.find((p) => p.pasoVisual === 3)?.count ?? 0) >= 1);

    const list11 = await repo.listExpedientesSnapshotPage({
      estado: "todos",
      etapaActual: 11,
      page: 1,
      pageSize: 25,
    });
    assert.equal(list11.totalCount, 1);
    assert.equal(list11.items[0]?.expedienteId, "e-11");

    const clearEtapa = await repo.listExpedientesSnapshotPage({
      estado: "todos",
      page: 1,
      pageSize: 100,
    });
    assert.equal(clearEtapa.totalCount, 6);

    const buscar = await repo.getExpedientesSnapshotEtapas({
      estado: "todos",
      buscar: "Reingreso Manual",
    });
    assert.equal(buscar.totalActual, 1);

    const cohortPeriodo = await repo.getMesaCohortByEtapa({
      bounds: boundsHoy,
      estado: "todos",
    });
    assert.equal(cohortPeriodo.total, 2, "cohort legado sigue por periodo");
    assert.ok(snapA.totalActual > cohortPeriodo.total);
  });

  it("filtro asesor reduce snapshot sin tocar semántica periodo Excel", async () => {
    const a1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const a2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const items = [
      stub({ id: "a", asesorId: a1, fechaEnvioMesa: "2026-07-10T12:00:00.000Z", etapaActual: 2 }),
      stub({ id: "b", asesorId: a2, fechaEnvioMesa: "2026-07-10T12:00:00.000Z", etapaActual: 5 }),
    ];
    const repo = new MockAdminProductionRepo({
      listForAdmin: async () => items,
    } as unknown as ExpedientesRepo);
    const snap = await repo.getExpedientesSnapshotEtapas({
      asesorId: a1,
      estado: "todos",
    });
    assert.equal(snap.totalActual, 1);
    assert.equal(snap.byEtapa.find((b) => b.etapa === 2)?.count, 1);
    assert.equal(snap.byEtapa.find((b) => b.etapa === 5)?.count, 0);
  });
});
