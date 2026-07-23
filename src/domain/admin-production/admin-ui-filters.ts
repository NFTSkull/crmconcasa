/** Helpers puros de UI Admin (navegación etapa / foco) — testeables sin React. */

import {
  ETAPAS_VISUALES_OPERATIVAS,
  mapEtapaInternaAPasoVisual,
  TOTAL_PASOS_VISUALES_OPERATIVOS,
} from "@/domain/expedientes/asesor-seguimiento-operativo";
import { etapasInternasParaFiltroPaso } from "@/domain/expedientes/etapa-numeracion-ux";

/** Toggle de tarjeta/filtro: mismo valor activo → "todas"; si no → String(valor). */
export function nextEtapaFilterFromCard(
  currentEtapaFilter: string,
  pressedEtapa: number,
): string {
  const next = String(pressedEtapa);
  return currentEtapaFilter === next ? "todas" : next;
}

/**
 * P115: tarjetas de cohort siguen en etapa interna 1–12; el filtro general
 * usa paso visual 1–11 (interna 3 y 4 → paso 3).
 */
export function nextPasoVisualFilterFromInternalCard(
  currentPasoFilter: string,
  pressedEtapaInterna: number,
): string {
  const paso = mapEtapaInternaAPasoVisual(pressedEtapaInterna);
  return nextEtapaFilterFromCard(currentPasoFilter, paso);
}

export function isAdminPasoVisualFilterPressed(
  currentPasoFilter: string,
  etapaInternaBucket: number,
): boolean {
  if (currentPasoFilter === "todas") return false;
  return mapEtapaInternaAPasoVisual(etapaInternaBucket) === Number(currentPasoFilter);
}

/** Opciones del select «Etapa actual» del dashboard Admin: 11 pasos visibles. */
export function opcionesFiltroPasoAdminDashboard(): ReadonlyArray<{
  value: string;
  label: string;
}> {
  return ETAPAS_VISUALES_OPERATIVAS.map((e) => ({
    value: String(e.pasoVisual),
    label: `${e.pasoVisual}. ${e.nombre}`,
  }));
}

export function labelPasoVisualAdminFilter(pasoFilter: string): string | null {
  if (pasoFilter === "todas") return null;
  const paso = Number(pasoFilter);
  const entry = ETAPAS_VISUALES_OPERATIVAS.find((e) => e.pasoVisual === paso);
  if (!entry) return null;
  return `Paso ${entry.pasoVisual} de ${TOTAL_PASOS_VISUALES_OPERATIVOS} — ${entry.nombre}`;
}

/** Internas a enviar a repos/RPC (Paso 3 → [3,4]). */
export function etapaActualesFromAdminPasoFilter(
  pasoFilter: string,
): number[] | null {
  return etapasInternasParaFiltroPaso(pasoFilter);
}

/** Tras aplicar etapa, la página de expedientes debe reiniciarse a 1. */
export function mesaPageAfterEtapaChange(): number {
  return 1;
}

/** Ambas paginaciones al cambiar asesor. */
export function pagesAfterAsesorChange(): { mesaPage: number; precalPage: number } {
  return { mesaPage: 1, precalPage: 1 };
}
