/**
 * Filtro Admin «Corrección» — estados canónicos de asesor_correccion_detalle.ux_state.
 * No mezclar «pendiente de corregir» con «reenviada / esperando Mesa».
 */
import type { AsesorCorreccionUxState } from "@/domain/expedientes/asesor-correccion-detalle";

export type AdminCorreccionFilter =
  | "todas"
  | "PENDIENTE_DE_CORREGIR"
  | "CAMBIOS_GUARDADOS_SIN_ENVIAR"
  | "CORRECCION_ENVIADA";

/** Universo del listado/PDF de correcciones. Default: periodo (comportamiento previo). */
export type AdminCorreccionAlcance = "periodo_seleccionado" | "pendientes_actuales";

export const ADMIN_CORRECCION_UX_STATES = [
  "PENDIENTE_DE_CORREGIR",
  "CAMBIOS_GUARDADOS_SIN_ENVIAR",
  "CORRECCION_ENVIADA",
] as const satisfies readonly AsesorCorreccionUxState[];

export const ADMIN_CORRECCION_FILTER_OPTIONS: ReadonlyArray<{
  value: AdminCorreccionFilter;
  label: string;
}> = [
  { value: "todas", label: "Todas" },
  { value: "PENDIENTE_DE_CORREGIR", label: "Pendiente de corregir" },
  { value: "CAMBIOS_GUARDADOS_SIN_ENVIAR", label: "Falta reenviar" },
  { value: "CORRECCION_ENVIADA", label: "Reenviada / esperando Mesa" },
];

export const ADMIN_CORRECCION_ALCANCE_OPTIONS: ReadonlyArray<{
  value: AdminCorreccionAlcance;
  label: string;
}> = [
  { value: "periodo_seleccionado", label: "Periodo seleccionado" },
  { value: "pendientes_actuales", label: "Pendientes actuales" },
];

export function isAdminCorreccionFilterActive(
  filter: AdminCorreccionFilter,
): boolean {
  return filter !== "todas";
}

export function isAdminCorreccionAlcancePendientesActuales(
  alcance: AdminCorreccionAlcance,
): boolean {
  return alcance === "pendientes_actuales";
}

/**
 * Pipeline corrección (exportAll/snapshot + detalle) cuando el filtro de
 * corrección está activo O el alcance es stock vigente.
 */
export function needsAdminCorreccionUniversePipeline(args: {
  filter: AdminCorreccionFilter;
  alcance: AdminCorreccionAlcance;
}): boolean {
  return (
    isAdminCorreccionFilterActive(args.filter) ||
    isAdminCorreccionAlcancePendientesActuales(args.alcance)
  );
}

export function isAdminCorreccionUxVigente(
  ux: string | null | undefined,
): ux is AsesorCorreccionUxState {
  return (
    ux === "PENDIENTE_DE_CORREGIR" ||
    ux === "CAMBIOS_GUARDADOS_SIN_ENVIAR" ||
    ux === "CORRECCION_ENVIADA"
  );
}

/** Etiqueta corta del filtro / encabezado PDF. */
export function adminCorreccionFilterLabel(
  filter: AdminCorreccionFilter,
): string {
  return (
    ADMIN_CORRECCION_FILTER_OPTIONS.find((o) => o.value === filter)?.label ??
    "Todas"
  );
}

export function adminCorreccionAlcanceLabel(
  alcance: AdminCorreccionAlcance,
): string {
  return (
    ADMIN_CORRECCION_ALCANCE_OPTIONS.find((o) => o.value === alcance)?.label ??
    "Periodo seleccionado"
  );
}

/** Etiqueta de estado vigente (tarjeta PDF / UI). */
export function adminCorreccionUxStateLabel(
  ux: AsesorCorreccionUxState,
): string {
  switch (ux) {
    case "PENDIENTE_DE_CORREGIR":
      return "Pendiente de corregir";
    case "CAMBIOS_GUARDADOS_SIN_ENVIAR":
      return "Falta reenviar";
    case "CORRECCION_ENVIADA":
      return "Reenviada / esperando Mesa";
    default: {
      const _exhaustive: never = ux;
      return _exhaustive;
    }
  }
}

/**
 * Banner operativo por estado (PDF).
 * CORRECCION_ENVIADA NO usa lenguaje de «aún debes corregir».
 */
export function adminCorreccionUxBanner(
  ux: AsesorCorreccionUxState,
): string | null {
  switch (ux) {
    case "PENDIENTE_DE_CORREGIR":
      return null;
    case "CAMBIOS_GUARDADOS_SIN_ENVIAR":
      return "CAMBIOS GUARDADOS — FALTA REENVIAR A MESA";
    case "CORRECCION_ENVIADA":
      return "CORRECCIÓN REENVIADA — ESPERANDO REVISIÓN DE MESA";
    default: {
      const _exhaustive: never = ux;
      return _exhaustive;
    }
  }
}

export function matchesAdminCorreccionFilter(
  ux: string | null | undefined,
  filter: AdminCorreccionFilter,
): boolean {
  if (!isAdminCorreccionUxVigente(ux)) return false;
  if (filter === "todas") return true;
  return ux === filter;
}

/** Paginación visual sobre un conjunto ya filtrado en memoria. */
export function paginateAdminFilteredItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): { items: T[]; totalCount: number; page: number; pageSize: number } {
  const size = Math.min(100, Math.max(1, pageSize || 25));
  const totalCount = items.length;
  const maxPage = Math.max(1, Math.ceil(totalCount / size) || 1);
  const p = Math.min(Math.max(1, page || 1), maxPage);
  const from = (p - 1) * size;
  return {
    items: items.slice(from, from + size),
    totalCount,
    page: p,
    pageSize: size,
  };
}
