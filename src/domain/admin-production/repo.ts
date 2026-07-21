import type { AdminPeriodBounds } from "./period";
import type { AdminMesaEnvioEvent, AdminPrecalEvent, AdminProductionSummary } from "./metrics";
import type { AdminMesaTimelineEvent } from "./mesa-seguimiento";

export type AdminEstadoFilter =
  | "todos"
  | "activos"
  | "finalizados"
  | "rechazados"
  /** P094: ciclo_estado=cancelado (separado de rechazados). */
  | "cancelados";
/** Filtro tabla Precal: default UX = resueltas (aprobadas + no_cumple del periodo). */
export type AdminPrecalDecisionFilter =
  | "resueltas"
  | "todas"
  | "aprobadas"
  | "no_cumple"
  | "pendientes";

export type AdminProductionFilters = Readonly<{
  bounds: AdminPeriodBounds;
  asesorId?: string | null;
  etapaActual?: number | null;
  estado?: AdminEstadoFilter | null;
  buscar?: string | null;
  precalDecision?: AdminPrecalDecisionFilter | null;
  page?: number;
  pageSize?: number;
}>;

export type AdminAsesorProductionRow = Readonly<{
  asesorId: string;
  asesorNombre: string | null;
  asesorEmail: string | null;
  enviadosAMesa: number;
  precalificacionesAprobadas: number;
  precalificacionesNoCumple: number;
  aprobadasMayorA20000: number;
  montoAprobadoTotal: number;
  etapas: Readonly<Record<string, number>>;
}>;

export type AdminEtapaBucket = Readonly<{
  etapa: number;
  count: number;
  pct: number;
}>;

export type AdminPaginated<T> = Readonly<{
  items: readonly T[];
  totalCount: number;
  page: number;
  pageSize: number;
}>;

export type AdminPrecalSummary = Readonly<{
  resueltasCount: number;
  aprobadasCount: number;
  noCumpleCount: number;
  pendientesActualesCount: number;
  mayores20000Count: number;
  mejoravitAprobadasCount: number;
  montoMejoravitTotal: number;
  montoMejoravitPromedio: number;
}>;

export type AdminMesaTimelinePage = Readonly<{
  expedienteId: string;
  totalCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  items: readonly AdminMesaTimelineEvent[];
}>;

export interface AdminProductionRepo {
  getSummary(filters: AdminProductionFilters): Promise<AdminProductionSummary>;
  getMesaCohortByEtapa(
    filters: AdminProductionFilters,
  ): Promise<{ total: number; byEtapa: readonly AdminEtapaBucket[] }>;
  listByAsesor(filters: AdminProductionFilters): Promise<readonly AdminAsesorProductionRow[]>;
  listMesaEnviosPage(
    filters: AdminProductionFilters,
  ): Promise<AdminPaginated<AdminMesaEnvioEvent>>;
  listPrecalificacionesPage(
    filters: AdminProductionFilters,
  ): Promise<AdminPaginated<AdminPrecalEvent> & { summary: AdminPrecalSummary }>;
  /** Timeline detallado bajo demanda (no embebido en el listado). */
  getExpedienteMesaTimeline(input: {
    expedienteId: string;
    limit?: number;
    offset?: number;
  }): Promise<AdminMesaTimelinePage>;
  /** Exporta todos los resultados filtrados vía paginación RPC hasta total_count. */
  exportAll(filters: AdminProductionFilters): Promise<{
    mesaEnvios: readonly AdminMesaEnvioEvent[];
    precalificaciones: readonly AdminPrecalEvent[];
    asesores: readonly AdminAsesorProductionRow[];
    summary: AdminProductionSummary;
    precalSummary: AdminPrecalSummary;
  }>;
}
