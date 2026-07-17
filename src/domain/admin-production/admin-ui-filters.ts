/** Helpers puros de UI Admin (navegación etapa / foco) — testeables sin React. */

import type { AdminPeriodBounds } from "./period";
import type {
  AdminAsesorProductionRow,
  AdminEstadoFilter,
  AdminProductionFilters,
} from "./repo";

/** Toggle de tarjeta de etapa: misma etapa activa → "todas"; si no → String(etapa). */
export function nextEtapaFilterFromCard(
  currentEtapaFilter: string,
  pressedEtapa: number,
): string {
  const next = String(pressedEtapa);
  return currentEtapaFilter === next ? "todas" : next;
}

/** Tras aplicar etapa, la página de expedientes debe reiniciarse a 1. */
export function mesaPageAfterEtapaChange(): number {
  return 1;
}

/** Ambas paginaciones al cambiar asesor. */
export function pagesAfterAsesorChange(): { mesaPage: number; precalPage: number } {
  return { mesaPage: 1, precalPage: 1 };
}

/**
 * Filtros que consume `admin_list_production_by_asesor`:
 * periodo + estado + asesor opcional.
 * No incluye etapa, búsqueda ni decisión de precalificación.
 */
export function buildProduccionAsesorFilters(input: {
  bounds: AdminPeriodBounds;
  asesorId: string | null;
  estado: AdminEstadoFilter;
}): AdminProductionFilters {
  return {
    bounds: input.bounds,
    asesorId: input.asesorId,
    estado: input.estado,
    etapaActual: null,
    buscar: null,
    precalDecision: null,
  };
}

/** Vigencia del selector de asesores: periodo + estado. */
export function produccionAsesorOptionsKey(
  bounds: AdminPeriodBounds,
  estado: AdminEstadoFilter,
): string {
  return `${bounds.fromIso}|${bounds.toExclusiveIso}|${estado}`;
}

/** Vigencia de la tabla visible: periodo + estado + asesor. */
export function produccionAsesorProductionKey(
  bounds: AdminPeriodBounds,
  estado: AdminEstadoFilter,
  asesorId: string | null,
): string {
  return `${produccionAsesorOptionsKey(bounds, estado)}|${asesorId ?? ""}`;
}

export type ProduccionAsesorFetchPlan =
  | {
      mode: "shared";
      filters: AdminProductionFilters;
      nextOptionsKey: string;
    }
  | {
      mode: "table_only";
      tableFilters: AdminProductionFilters;
    }
  | {
      mode: "table_and_options";
      tableFilters: AdminProductionFilters;
      optionsFilters: AdminProductionFilters;
      nextOptionsKey: string;
    };

/**
 * Decide cuántas llamadas a `listByAsesor` hacer.
 * - Sin asesor: 1 llamada compartida (tabla = opciones).
 * - Con asesor y opciones vigentes: 1 llamada filtrada.
 * - Con asesor y opciones obsoletas: 2 llamadas (filtrada + sin asesor).
 */
export function planProduccionAsesorFetch(input: {
  bounds: AdminPeriodBounds;
  estado: AdminEstadoFilter;
  asesorId: string | null;
  optionsKeyLoaded: string | null;
}): ProduccionAsesorFetchPlan {
  const optionsKey = produccionAsesorOptionsKey(input.bounds, input.estado);
  const tableFilters = buildProduccionAsesorFilters({
    bounds: input.bounds,
    asesorId: input.asesorId,
    estado: input.estado,
  });

  if (!input.asesorId) {
    return {
      mode: "shared",
      filters: tableFilters,
      nextOptionsKey: optionsKey,
    };
  }

  if (input.optionsKeyLoaded === optionsKey) {
    return { mode: "table_only", tableFilters };
  }

  return {
    mode: "table_and_options",
    tableFilters,
    optionsFilters: { ...tableFilters, asesorId: null },
    nextOptionsKey: optionsKey,
  };
}

export type ProduccionAsesorFetchResult = Readonly<{
  asesores: readonly AdminAsesorProductionRow[];
  /** null = conservar opciones previas. */
  asesorOptions: readonly AdminAsesorProductionRow[] | null;
  /** null = no actualizar la clave de opciones cargadas. */
  nextOptionsKey: string | null;
  listByAsesorCalls: number;
}>;

export async function fetchProduccionAsesorPlan(
  plan: ProduccionAsesorFetchPlan,
  listByAsesor: (
    filters: AdminProductionFilters,
  ) => Promise<readonly AdminAsesorProductionRow[]>,
): Promise<ProduccionAsesorFetchResult> {
  if (plan.mode === "shared") {
    const rows = await listByAsesor(plan.filters);
    return {
      asesores: rows,
      asesorOptions: rows,
      nextOptionsKey: plan.nextOptionsKey,
      listByAsesorCalls: 1,
    };
  }
  if (plan.mode === "table_only") {
    const rows = await listByAsesor(plan.tableFilters);
    return {
      asesores: rows,
      asesorOptions: null,
      nextOptionsKey: null,
      listByAsesorCalls: 1,
    };
  }
  const [table, opts] = await Promise.all([
    listByAsesor(plan.tableFilters),
    listByAsesor(plan.optionsFilters),
  ]);
  return {
    asesores: table,
    asesorOptions: opts,
    nextOptionsKey: plan.nextOptionsKey,
    listByAsesorCalls: 2,
  };
}
