/**
 * Producción Admin — métrica primaria por etapa + expand on-demand.
 * Solo presentación / identidad de query; no cambia RPCs ni writers.
 */

import type { AdminPeriodBounds } from "./period";
import type { AdminEstadoFilter, AdminProductionFilters } from "./repo";
import { etapaActualesFromAdminPasoFilter } from "./admin-ui-filters";
import { shortAdminPasoFilterNombre } from "./admin-visible-stages";

export const ADMIN_PRODUCTION_EXPAND_PAGE_SIZE = 25;

export type AdminProductionPrimaryMetric = Readonly<{
  label: string;
  value: number;
}>;

/** P1/P2: sin etapa → ENVIADOS; con etapa → nombre corto + stageCount. */
export function adminProductionPrimaryMetric(input: {
  etapaPasoFilter: string;
  stageCount: number | null;
  enviadosAMesa: number;
}): AdminProductionPrimaryMetric {
  const nombre = shortAdminPasoFilterNombre(input.etapaPasoFilter);
  if (nombre && input.stageCount != null) {
    return { label: nombre.toUpperCase(), value: input.stageCount };
  }
  return { label: "ENVIADOS", value: input.enviadosAMesa };
}

/** ¿Mostrar el subtítulo «Firmado: N» bajo el nombre? No: duplica la métrica. */
export function shouldShowProductionStageSubtitleUnderName(): boolean {
  return false;
}

export type AdminProductionExpandIdentity = Readonly<{
  asesorId: string;
  fromIso: string;
  toExclusiveIso: string;
  etapaPaso: string;
  estado: AdminEstadoFilter | string;
  page: number;
}>;

export function buildAdminProductionExpandIdentity(input: {
  asesorId: string;
  bounds: AdminPeriodBounds;
  etapaPaso: string;
  estado: AdminEstadoFilter | string;
  page: number;
}): AdminProductionExpandIdentity {
  return {
    asesorId: input.asesorId,
    fromIso: input.bounds.fromIso,
    toExclusiveIso: input.bounds.toExclusiveIso,
    etapaPaso: input.etapaPaso,
    estado: input.estado,
    page: input.page,
  };
}

export function adminProductionExpandIdentityKey(
  id: AdminProductionExpandIdentity,
): string {
  return [
    id.asesorId,
    id.fromIso,
    id.toExclusiveIso,
    id.etapaPaso,
    id.estado,
    String(id.page),
  ].join("|");
}

/** Misma identidad salvo página (para invalidar lista al cambiar filtros). */
export function adminProductionExpandScopeKey(
  id: Pick<
    AdminProductionExpandIdentity,
    "asesorId" | "fromIso" | "toExclusiveIso" | "etapaPaso" | "estado"
  >,
): string {
  return [
    id.asesorId,
    id.fromIso,
    id.toExclusiveIso,
    id.etapaPaso,
    id.estado,
  ].join("|");
}

export function shouldApplyAdminProductionExpandResult(
  activeKey: string | null,
  resultKey: string,
): boolean {
  return activeKey != null && activeKey === resultKey;
}

/** Filtros para `listMesaEnviosPage` al Expandir una fila. */
export function buildAdminProductionExpandFilters(input: {
  filtersBase: Omit<
    AdminProductionFilters,
    "etapaActual" | "etapaActuales" | "page" | "pageSize" | "asesorId"
  > & {
    asesorId?: string | null;
    etapaActual?: number | null;
    etapaActuales?: readonly number[] | null;
  };
  asesorId: string;
  etapaPaso: string;
  page: number;
  pageSize?: number;
}): AdminProductionFilters {
  const etapaActuales = etapaActualesFromAdminPasoFilter(input.etapaPaso);
  return {
    ...input.filtersBase,
    asesorId: input.asesorId,
    etapaActual:
      etapaActuales?.length === 1 ? etapaActuales[0]! : null,
    etapaActuales,
    page: input.page,
    pageSize: input.pageSize ?? ADMIN_PRODUCTION_EXPAND_PAGE_SIZE,
  };
}

export function adminProductionExpandTitle(input: {
  etapaPaso: string;
}): string {
  const nombre = shortAdminPasoFilterNombre(input.etapaPaso);
  if (nombre) return `Expedientes en ${nombre}`;
  return "Expedientes enviados en el periodo";
}

export function adminProductionExpandSubtitle(input: {
  totalCount: number;
  advisorLabel: string;
  etapaPaso: string;
}): string {
  const n = input.totalCount;
  const exp = `${n} expediente${n === 1 ? "" : "s"}`;
  const nombre = shortAdminPasoFilterNombre(input.etapaPaso);
  if (nombre) {
    return `${exp} de ${input.advisorLabel} en el periodo seleccionado.`;
  }
  return `${exp} de ${input.advisorLabel} enviados en el periodo seleccionado.`;
}

export function adminProductionExpandExpedientesCtaLabel(
  etapaPaso: string,
): string {
  return shortAdminPasoFilterNombre(etapaPaso)
    ? "Ver todos en Expedientes"
    : "Ver expedientes de este asesor";
}

/** true si hay más páginas y no debe truncarse en silencio. */
export function adminProductionExpandNeedsPagination(
  totalCount: number,
  pageSize: number = ADMIN_PRODUCTION_EXPAND_PAGE_SIZE,
): boolean {
  return totalCount > pageSize;
}

export function adminProductionExpandTotalPages(
  totalCount: number,
  pageSize: number = ADMIN_PRODUCTION_EXPAND_PAGE_SIZE,
): number {
  if (totalCount <= 0) return 1;
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

/** Discrepancia visible stageCount (row.etapas) vs totalCount (lista). */
export function adminProductionExpandCountMismatch(input: {
  stageCount: number | null;
  totalCount: number;
}): boolean {
  if (input.stageCount == null) return false;
  return input.stageCount !== input.totalCount;
}
