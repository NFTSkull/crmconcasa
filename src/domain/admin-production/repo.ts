import type { AdminPeriodBounds } from "./period";
import type { AdminMesaEnvioEvent, AdminPrecalEvent, AdminProductionSummary } from "./metrics";

export type AdminEstadoFilter = "todos" | "activos" | "finalizados" | "rechazados";
export type AdminPrecalDecisionFilter =
  | "todas"
  | "aprobadas"
  | "aprobadas_mayor_20000"
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
  total: number;
  aprobadas: number;
  aprobadasMayorA20000: number;
  noCumple: number;
  pendientes: number;
  montoAprobadoTotal: number;
  montoPromedioAprobado: number;
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
  /** Exporta todos los resultados filtrados (no solo la página). Máx. 5000 por hoja. */
  exportAll(filters: AdminProductionFilters): Promise<{
    mesaEnvios: readonly AdminMesaEnvioEvent[];
    precalificaciones: readonly AdminPrecalEvent[];
    asesores: readonly AdminAsesorProductionRow[];
    summary: AdminProductionSummary;
  }>;
}
