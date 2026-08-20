/** Helpers puros de UI Admin (navegación etapa / foco) — testeables sin React. */

import {
  etapasInternasParaAdminPasoFilter,
  labelAdminPasoFilter,
  mapEtapaInternaAAdminPaso,
  opcionesFiltroPasoAdminVisible,
  shortAdminPasoFilterNombre,
  TOTAL_PASOS_ADMIN_VISIBLES,
} from "./admin-visible-stages";

/** Toggle de tarjeta/filtro: mismo valor activo → "todas"; si no → String(valor). */
export function nextEtapaFilterFromCard(
  currentEtapaFilter: string,
  pressedEtapa: number,
): string {
  const next = String(pressedEtapa);
  return currentEtapaFilter === next ? "todas" : next;
}

/**
 * Tarjetas Resumen (etapa interna) → filtro de paso Admin.
 * Interna 10 (legacy firma) y 9 → mismo paso Admin 8.
 * Interna 4 (legacy bio) → paso Admin 3 (P115).
 */
export function nextPasoVisualFilterFromInternalCard(
  currentPasoFilter: string,
  pressedEtapaInterna: number,
): string {
  const paso = mapEtapaInternaAAdminPaso(pressedEtapaInterna);
  return nextEtapaFilterFromCard(currentPasoFilter, paso);
}

export function isAdminPasoVisualFilterPressed(
  currentPasoFilter: string,
  etapaInternaBucket: number,
): boolean {
  if (currentPasoFilter === "todas") return false;
  return mapEtapaInternaAAdminPaso(etapaInternaBucket) === Number(currentPasoFilter);
}

/** Opciones del select «Etapa actual» Admin: 10 pasos (sin «Cita para firma»). */
export function opcionesFiltroPasoAdminDashboard(): ReadonlyArray<{
  value: string;
  label: string;
}> {
  return opcionesFiltroPasoAdminVisible();
}

export function labelPasoVisualAdminFilter(pasoFilter: string): string | null {
  return labelAdminPasoFilter(pasoFilter);
}

/** Internas a enviar a repos/RPC (Admin paso 3 → [3,4]; paso 8 → [9,10]). */
export function etapaActualesFromAdminPasoFilter(
  pasoFilter: string,
): number[] | null {
  return etapasInternasParaAdminPasoFilter(pasoFilter);
}

/**
 * Matriz de contrato Admin (periodo × panel) — solo documentación testeable.
 * Resumen snapshot: independiente del periodo.
 * Expedientes / Producción / Precal: respetan periodo.
 */
export const ADMIN_FILTER_MATRIX = {
  resumenSnapshot: { periodo: false, asesor: true, etapa: true, estado: true },
  expedientesPeriodo: { periodo: true, asesor: true, etapa: true, estado: true },
  produccion: { periodo: true, asesor: true, etapa: true, estado: true },
  precal: { periodo: true, asesor: true, etapa: false, estado: true },
} as const;

/** Tras aplicar etapa, la página de expedientes debe reiniciarse a 1. */
export function mesaPageAfterEtapaChange(): number {
  return 1;
}

/** Ambas paginaciones al cambiar asesor. */
export function pagesAfterAsesorChange(): { mesaPage: number; precalPage: number } {
  return { mesaPage: 1, precalPage: 1 };
}

export { shortAdminPasoFilterNombre, TOTAL_PASOS_ADMIN_VISIBLES };
