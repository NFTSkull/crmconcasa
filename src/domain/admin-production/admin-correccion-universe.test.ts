import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminSnapshotFiltersFromProduction,
  fetchAllAdminSnapshotExpedientes,
  loadAdminCorreccionUniverse,
} from "./admin-correccion-universe";
import { emptyAdminMesaSeguimientoFields } from "./metrics";
import type { AdminMesaEnvioEvent } from "./metrics";
import type { AdminPaginated, AdminSnapshotFilters } from "./repo";

function mesa(
  id: string,
  opts?: Partial<AdminMesaEnvioEvent>,
): AdminMesaEnvioEvent {
  return {
    expedienteId: id,
    fechaEnvioMesa: "2026-08-01T12:00:00.000Z",
    clienteNombre: `Cliente ${id}`,
    asesorId: "silvia",
    asesorNombre: "SILVIA REYES",
    programa: "mejoravit",
    etapaActual: 5,
    subestado: "en_proceso",
    cicloEstado: "activo",
    ...emptyAdminMesaSeguimientoFields("2026-08-01T12:00:00.000Z"),
    etapaLabel: "Integración",
    ...opts,
  };
}

describe("admin-correccion-universe (alcance)", () => {
  it("Periodo seleccionado usa exportAll (respeta bounds vía periodFilters)", async () => {
    let exportCalls = 0;
    let snapshotCalls = 0;
    const periodItem = mesa("period-only");
    const result = await loadAdminCorreccionUniverse({
      alcance: "periodo_seleccionado",
      exportAll: async () => {
        exportCalls += 1;
        return { mesaEnvios: [periodItem] };
      },
      periodFilters: {
        bounds: {
          preset: "mes",
          fromIso: "2026-09-01T06:00:00.000Z",
          toExclusiveIso: "2026-10-01T06:00:00.000Z",
          fromDate: "2026-09-01",
          toDateInclusive: "2026-09-30",
        },
        asesorId: "silvia",
        estado: "todos",
      },
      listSnapshotPage: async () => {
        snapshotCalls += 1;
        return { items: [mesa("snap")], totalCount: 1, page: 1, pageSize: 100 };
      },
      snapshotFilters: { asesorId: "silvia" },
    });
    assert.equal(exportCalls, 1);
    assert.equal(snapshotCalls, 0);
    assert.equal(result.usedPeriodBounds, true);
    assert.deepEqual(
      result.mesaEnvios.map((m) => m.expedienteId),
      ["period-only"],
    );
  });

  it("Pendientes actuales ignora bounds y usa snapshot", async () => {
    let exportCalls = 0;
    const stock = [
      mesa("old-aug", { fechaEnvioMesa: "2026-08-01T12:00:00.000Z" }),
      mesa("old-jul", { fechaEnvioMesa: "2026-07-01T12:00:00.000Z" }),
    ];
    const result = await loadAdminCorreccionUniverse({
      alcance: "pendientes_actuales",
      exportAll: async () => {
        exportCalls += 1;
        return { mesaEnvios: [mesa("should-not-appear")] };
      },
      periodFilters: {
        bounds: {
          preset: "mes",
          fromIso: "2026-09-01T06:00:00.000Z",
          toExclusiveIso: "2026-10-01T06:00:00.000Z",
          fromDate: "2026-09-01",
          toDateInclusive: "2026-09-30",
        },
      },
      listSnapshotPage: async (f) => {
        assert.equal("bounds" in f, false);
        assert.equal(f.asesorId, "silvia");
        return {
          items: stock,
          totalCount: stock.length,
          page: f.page ?? 1,
          pageSize: f.pageSize ?? 100,
        };
      },
      snapshotFilters: { asesorId: "silvia" },
    });
    assert.equal(exportCalls, 0);
    assert.equal(result.usedPeriodBounds, false);
    assert.equal(result.alcance, "pendientes_actuales");
    assert.deepEqual(
      result.mesaEnvios.map((m) => m.expedienteId).sort(),
      ["old-aug", "old-jul"],
    );
  });

  it("Pendientes actuales conserva asesor/etapa/estado/buscar en snapshot filters", () => {
    const snap = adminSnapshotFiltersFromProduction({
      asesorId: "silvia",
      etapaActual: 5,
      etapaActuales: [5],
      estado: "activos",
      buscar: "maria",
    });
    assert.equal(snap.asesorId, "silvia");
    assert.equal(snap.etapaActual, 5);
    assert.deepEqual(snap.etapaActuales, [5]);
    assert.equal(snap.estado, "activos");
    assert.equal(snap.buscar, "maria");
    assert.equal("bounds" in snap, false);
  });

  it("fetchAllAdminSnapshotExpedientes pagina hasta total_count", async () => {
    const all = Array.from({ length: 3 }, (_, i) => mesa(`e${i}`));
    const calls: number[] = [];
    const listPage = async (
      f: AdminSnapshotFilters,
    ): Promise<AdminPaginated<AdminMesaEnvioEvent>> => {
      calls.push(f.page ?? 1);
      const size = f.pageSize ?? 2;
      const page = f.page ?? 1;
      const start = (page - 1) * size;
      return {
        items: all.slice(start, start + size),
        totalCount: all.length,
        page,
        pageSize: size,
      };
    };
    const got = await fetchAllAdminSnapshotExpedientes(listPage, { asesorId: "silvia" }, 2);
    assert.deepEqual(
      got.map((m) => m.expedienteId),
      ["e0", "e1", "e2"],
    );
    assert.deepEqual(calls, [1, 2]);
  });
});
