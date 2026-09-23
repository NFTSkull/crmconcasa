/**
 * Universo de expedientes para el pipeline de correcciones Admin.
 * - periodo_seleccionado → exportAll (respeta bounds)
 * - pendientes_actuales → stock vigente vía listExpedientesSnapshotPage (sin fechas)
 */
import type { AdminMesaEnvioEvent } from "./metrics";
import type {
  AdminPaginated,
  AdminProductionFilters,
  AdminSnapshotFilters,
} from "./repo";
import type { AdminCorreccionAlcance } from "./admin-correccion-filter";

export async function fetchAllAdminSnapshotExpedientes(
  listPage: (
    filters: AdminSnapshotFilters,
  ) => Promise<AdminPaginated<AdminMesaEnvioEvent>>,
  filters: Omit<AdminSnapshotFilters, "page" | "pageSize">,
  pageSize = 100,
): Promise<AdminMesaEnvioEvent[]> {
  const first = await listPage({ ...filters, page: 1, pageSize });
  const expected = first.totalCount;
  const items: AdminMesaEnvioEvent[] = [...first.items];
  let page = 2;
  while (items.length < expected) {
    const next = await listPage({ ...filters, page, pageSize });
    if (next.totalCount !== expected) {
      throw new Error(
        `Stock vigente incompleto: total_count cambió (${expected}→${next.totalCount}). Reintenta.`,
      );
    }
    if (next.items.length === 0) break;
    items.push(...next.items);
    page += 1;
    if (page > 10_000) {
      throw new Error("Stock vigente: demasiadas páginas. Reintenta.");
    }
  }
  if (items.length !== expected) {
    throw new Error(
      `Stock vigente incompleto: recuperadas ${items.length} de ${expected}. Reintenta.`,
    );
  }
  return items;
}

export function adminSnapshotFiltersFromProduction(
  filters: Pick<
    AdminProductionFilters,
    "asesorId" | "etapaActual" | "etapaActuales" | "estado" | "buscar"
  >,
): Omit<AdminSnapshotFilters, "page" | "pageSize"> {
  return {
    asesorId: filters.asesorId ?? null,
    etapaActual: filters.etapaActual ?? null,
    etapaActuales: filters.etapaActuales ?? null,
    estado: filters.estado ?? null,
    buscar: filters.buscar ?? null,
  };
}

/**
 * Carga el universo según alcance.
 * Pendientes actuales: NO usa bounds/from/to.
 */
export async function loadAdminCorreccionUniverse(args: {
  alcance: AdminCorreccionAlcance;
  /** Requerido si alcance = periodo_seleccionado. */
  exportAll: (
    filters: AdminProductionFilters,
  ) => Promise<{ mesaEnvios: readonly AdminMesaEnvioEvent[] }>;
  periodFilters: AdminProductionFilters | null;
  listSnapshotPage: (
    filters: AdminSnapshotFilters,
  ) => Promise<AdminPaginated<AdminMesaEnvioEvent>>;
  snapshotFilters: Omit<AdminSnapshotFilters, "page" | "pageSize">;
}): Promise<{
  mesaEnvios: readonly AdminMesaEnvioEvent[];
  alcance: AdminCorreccionAlcance;
  usedPeriodBounds: boolean;
}> {
  if (args.alcance === "pendientes_actuales") {
    const mesaEnvios = await fetchAllAdminSnapshotExpedientes(
      args.listSnapshotPage,
      args.snapshotFilters,
    );
    return {
      mesaEnvios,
      alcance: "pendientes_actuales",
      usedPeriodBounds: false,
    };
  }

  if (!args.periodFilters) {
    throw new Error("Rango de fechas inválido");
  }
  const { mesaEnvios } = await args.exportAll(args.periodFilters);
  return {
    mesaEnvios,
    alcance: "periodo_seleccionado",
    usedPeriodBounds: true,
  };
}
