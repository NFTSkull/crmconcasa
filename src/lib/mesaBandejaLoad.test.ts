import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import type { ClienteDatosEstadoBatch } from "@/domain/expediente-cliente-datos/types";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";
import type { AgendaNotificacionActiveBooking } from "@/domain/agenda-biometricos/repo";
import {
  chunkExpedienteIds,
  LIST_RESUMEN_BATCH_CHUNK_SIZE,
  normalizeExpedienteIdsForBatch,
} from "@/domain/expediente-archivos/list-resumen-batch";
import {
  expectedMesaBandejaInitialQueryBudget,
  fetchMesaBandejaResumenLegacyN1,
  fetchMesaBandejaSecondaryParallel,
  shouldRefetchMesaBandejaOnCurrentUserIdChange,
} from "@/lib/mesaBandejaLoad";
import {
  aplicarFiltrosBandejaMesa,
  contarVistaRapida,
  type MesaBandejaFiltroItem,
  type MesaBandejaFiltrosState,
} from "@/lib/mesaBandejaFiltros";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyResumen(expedienteId: string): ExpedienteArchivoResumen[] {
  return [
    {
      expediente_id: expedienteId,
      tipo_documento: "ine",
      id: null,
      nombre_original: null,
      mime_type: null,
      size_bytes: null,
      created_at: null,
      uploaded_by_role: null,
      uploaded_by_email: null,
      estatus_revision: "faltante",
      comentario_mesa: null,
    },
  ];
}

function filtroItem(
  partial: Partial<MesaBandejaFiltroItem> & Pick<MesaBandejaFiltroItem, "cliente_nombre">,
): MesaBandejaFiltroItem {
  return {
    telefono_cliente: "555",
    etapaActual: 1,
    subestado: "pendiente",
    cicloEstado: "activo",
    fechaCita: null,
    resumenDocumental: "faltantes",
    ...partial,
  };
}

function filtroState(
  partial?: Partial<MesaBandejaFiltrosState>,
): MesaBandejaFiltrosState {
  return {
    quickFilter: "todos",
    rechazosCancelacionesSubfiltro: "rechazados",
    buscar: "",
    etapa: "todas",
    subestado: "todas",
    soloCitasHoy: false,
    ...partial,
  };
}

describe("P100 mesa bandeja performance — medición controlada", () => {
  it("ANTES: N+1 listResumenByExpediente (1 llamada por expediente)", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `exp-${i + 1}`);
    const perCallMs = 8;

    const legacy = await fetchMesaBandejaResumenLegacyN1(ids, async (id) => {
      await delay(perCallMs);
      return emptyResumen(id);
    });

    assert.equal(legacy.listResumenByExpedienteCalls, 25);
    assert.equal(Object.keys(legacy.resumenPorId).length, 25);
    // Promise.all: wall ≈ max, no 25× secuencial; igual son 25 round-trips de red.
    assert.ok(
      legacy.elapsedMs >= perCallMs,
      `elapsedMs=${legacy.elapsedMs} debería reflejar al menos 1 round-trip`,
    );
  });

  it("DESPUÉS: 1 invocación batch + secundarias en paralelo (sin N+1)", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `exp-${i + 1}`);
    const perCallMs = 20;
    let batchCalls = 0;
    let estadoCalls = 0;
    let notifCalls = 0;
    let opsCalls = 0;
    let maxInFlight = 0;
    let inFlight = 0;

    const track = async <T>(fn: () => Promise<T>): Promise<T> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await delay(perCallMs);
        return await fn();
      } finally {
        inFlight -= 1;
      }
    };

    const result = await fetchMesaBandejaSecondaryParallel(
      { allExpedienteIds: ids, etapa3ExpedienteIds: ids.slice(0, 3) },
      {
        listResumenBatchByExpedienteIds: (batchIds) =>
          track(async () => {
            batchCalls += 1;
            const out: Record<string, ExpedienteArchivoResumen[]> = {};
            for (const id of batchIds) out[id] = emptyResumen(id);
            return out;
          }),
        listEstadoBatchByExpedienteIds: (batchIds) =>
          track(async () => {
            estadoCalls += 1;
            const out: Record<string, ClienteDatosEstadoBatch> = {};
            for (const id of batchIds) {
              out[id] = {
                estado: "pendiente",
                updatedAt: null,
                validatedAt: null,
              };
            }
            return out;
          }),
        listActiveNotificacionByExpedienteIds: () =>
          track(async () => {
            notifCalls += 1;
            return new Map<string, AgendaNotificacionActiveBooking>();
          }),
        listMesaOpsByExpedienteIds: () =>
          track(async () => {
            opsCalls += 1;
            return [] as MesaExpedienteOpsRow[];
          }),
      },
    );

    assert.equal(result.callCounts.listResumenBatch, 1);
    assert.equal(result.callCounts.listResumenByExpediente, 0);
    assert.equal(result.callCounts.listEstadoBatch, 1);
    assert.equal(result.callCounts.listNotificacion, 1);
    assert.equal(result.callCounts.listOps, 1);
    assert.equal(batchCalls, 1);
    assert.equal(estadoCalls, 1);
    assert.equal(notifCalls, 1);
    assert.equal(opsCalls, 1);
    assert.equal(Object.keys(result.resumenPorId).length, 25);
    // Paralelo: 4 in-flight a la vez; wall ≈ 1× perCallMs (no 4×).
    assert.ok(maxInFlight >= 4, `maxInFlight=${maxInFlight}`);
    assert.ok(
      result.elapsedMs < perCallMs * 3,
      `elapsedMs=${result.elapsedMs} debería ser ~paralelo (< ${perCallMs * 3})`,
    );
  });

  it("batch chunking: ceil(N/chunk) consultas, no N", () => {
    const ids = normalizeExpedienteIdsForBatch(
      Array.from({ length: 85 }, (_, i) => `e${i}`),
    );
    const chunks = chunkExpedienteIds(ids, LIST_RESUMEN_BATCH_CHUNK_SIZE);
    assert.equal(chunks.length, Math.ceil(85 / LIST_RESUMEN_BATCH_CHUNK_SIZE));
    assert.equal(
      chunks.reduce((acc, c) => acc + c.length, 0),
      85,
    );

    const budget = expectedMesaBandejaInitialQueryBudget({
      expedienteCount: 85,
      resumenBatchChunkSize: LIST_RESUMEN_BATCH_CHUNK_SIZE,
      includeNotificaciones: true,
      includeOps: true,
      includeAsesorDisplay: true,
    });
    assert.equal(budget.listExpedientes, 1);
    assert.equal(budget.resumenBatchChunks, 3);
    assert.equal(budget.listEstadoBatch, 1);
    // Antes: 1 list + 85 resumen + 1 estado + 1 notif + 1 ops (+1 display) × 2 por userId ≈ 178+
    // Después: 1 + 3 + 1 + 1 + 1 (+1 display) = 8 (sin doble carga)
    const queriesAfter =
      budget.listExpedientes +
      budget.resumenBatchChunks +
      budget.listEstadoBatch +
      budget.listNotificacion +
      budget.listOps +
      budget.asesorDisplay;
    assert.equal(queriesAfter, 8);
    assert.equal(shouldRefetchMesaBandejaOnCurrentUserIdChange(), false);
  });

  it("mismos resultados de filtros/contadores con resumen batch vs N+1", async () => {
    const ids = ["a", "b", "c"];
    const resumenLegacy = await fetchMesaBandejaResumenLegacyN1(ids, async (id) =>
      emptyResumen(id),
    );
    const resumenBatch = await fetchMesaBandejaSecondaryParallel(
      { allExpedienteIds: ids, etapa3ExpedienteIds: [] },
      {
        listResumenBatchByExpedienteIds: async (batchIds) => {
          const out: Record<string, ExpedienteArchivoResumen[]> = {};
          for (const id of batchIds) out[id] = emptyResumen(id);
          return out;
        },
        listEstadoBatchByExpedienteIds: async () => ({}),
      },
    );

    for (const id of ids) {
      assert.deepEqual(resumenLegacy.resumenPorId[id], resumenBatch.resumenPorId[id]);
    }

    const items = ids.map((id) =>
      filtroItem({ cliente_nombre: id, resumenDocumental: "faltantes" }),
    );
    const counts = contarVistaRapida(items, "2026-07-22");
    const filtered = aplicarFiltrosBandejaMesa(items, filtroState(), "2026-07-22");
    assert.equal(counts.nuevos, 3);
    assert.equal(filtered.length, 3);
  });

  it("errores parciales: fallo de resumen/ops no tumba la carga paralela", async () => {
    const result = await fetchMesaBandejaSecondaryParallel(
      { allExpedienteIds: ["x"], etapa3ExpedienteIds: ["x"] },
      {
        listResumenBatchByExpedienteIds: async () => {
          throw new Error("resumen down");
        },
        listEstadoBatchByExpedienteIds: async () => ({
          x: { estado: "completo", updatedAt: "t", validatedAt: null },
        }),
        listActiveNotificacionByExpedienteIds: async () => {
          throw new Error("notif down");
        },
        listMesaOpsByExpedienteIds: async () => {
          throw new Error("ops down");
        },
      },
    );
    assert.deepEqual(result.resumenPorId, {});
    assert.equal(result.estadosPorId.x?.estado, "completo");
    assert.equal(result.notificacionPorId.size, 0);
    assert.equal(result.opsRows.length, 0);
  });

  it("no regresión semántica: rechazos/cancelaciones intactas en helpers", () => {
    const items: MesaBandejaFiltroItem[] = [
      filtroItem({
        cliente_nombre: "R",
        etapaActual: 5,
        subestado: "rechazado",
        cicloEstado: "activo",
        resumenDocumental: "documentos_validados",
      }),
      filtroItem({
        cliente_nombre: "C",
        etapaActual: 2,
        subestado: "pendiente",
        cicloEstado: "cancelado",
        resumenDocumental: "faltantes",
      }),
    ];

    const counts = contarVistaRapida(items, "2026-07-22");
    assert.equal(counts.rechazosCancelaciones, 2);

    const rechazados = aplicarFiltrosBandejaMesa(
      items,
      filtroState({
        quickFilter: "rechazos_cancelaciones",
        rechazosCancelacionesSubfiltro: "rechazados",
      }),
      "2026-07-22",
    );
    const cancelados = aplicarFiltrosBandejaMesa(
      items,
      filtroState({
        quickFilter: "rechazos_cancelaciones",
        rechazosCancelacionesSubfiltro: "cancelados",
      }),
      "2026-07-22",
    );
    assert.deepEqual(
      rechazados.map((r) => r.cliente_nombre),
      ["R"],
    );
    assert.deepEqual(
      cancelados.map((r) => r.cliente_nombre),
      ["C"],
    );
  });
});
