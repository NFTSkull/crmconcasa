/**
 * P105 — Numeración operativa visible (11 pasos) compartida Asesor/Mesa.
 * `etapa_actual` interna 1–12 no se muta; solo presentación y filtros UI.
 */

import {
  ETAPAS_VISUALES_OPERATIVAS,
  etapasInternasParaPasoVisual,
  getEtapaOperativaNombre,
  getEtapaVisualNombre,
  mapEtapaInternaAPasoVisual,
  resolveEtapaActualOperativa,
  TOTAL_PASOS_VISUALES_OPERATIVOS,
} from "./asesor-seguimiento-operativo";

export type CorrespondenciaNumeracionEtapa = Readonly<{
  etapaInterna: number;
  pasoVisual: number;
  /** Nombre según catálogo interno 1–12. */
  nombreMesa: string;
  /** Nombre según timeline visual 1–11. */
  nombreAsesor: string;
  /** true cuando el número interno y el paso visual no coinciden. */
  numeracionDifiere: boolean;
}>;

export const NOTA_NUMERACION_ETAPAS =
  "Asesor y Mesa muestran 11 pasos visibles. La base conserva `etapa_actual` 1–12 (la etapa legacy 4 se absorbe en el paso 3).";

export function getCorrespondenciaNumeracionEtapa(
  etapaActual: number | null | undefined,
): CorrespondenciaNumeracionEtapa {
  const etapaInterna = resolveEtapaActualOperativa(etapaActual);
  const pasoVisual = mapEtapaInternaAPasoVisual(etapaInterna);
  return {
    etapaInterna,
    pasoVisual,
    nombreMesa: getEtapaOperativaNombre(etapaInterna),
    nombreAsesor: getEtapaVisualNombre(etapaInterna),
    numeracionDifiere: etapaInterna !== pasoVisual,
  };
}

/** Etiqueta canónica UI: «Paso 4 de 11 — Biometría (resultado)». */
export function formatPasoOperativoLabel(
  etapaActual: number | null | undefined,
): string {
  const c = getCorrespondenciaNumeracionEtapa(etapaActual);
  return `Paso ${c.pasoVisual} de ${TOTAL_PASOS_VISUALES_OPERATIVOS} — ${c.nombreAsesor}`;
}

/**
 * Destino canónico de movimiento manual (P106): misma etiqueta que el paso visible.
 * La interna 4 no es seleccionable; se muestra como Paso 3 vía `formatPasoOperativoLabel`.
 */
export function formatPasoOperativoDestinoLabel(etapaInterna: number): string {
  return formatPasoOperativoLabel(etapaInterna);
}

/**
 * Opciones del selector «Paso destino» (P106): exactamente 11 pasos únicos.
 * `etapaInternaDestino` es la canónica (paso 3 → 3, paso 4 → 5, …); nunca 4.
 */
export type OpcionMovimientoManualPaso = Readonly<{
  pasoVisual: number;
  etapaInternaDestino: number;
  label: string;
}>;

export function opcionesMovimientoManualPaso(opts?: {
  /** Paso visual actual a excluir (p. ej. 3 si el expediente está en interna 3 o 4). */
  excluirPasoVisualActual?: number | null;
}): readonly OpcionMovimientoManualPaso[] {
  const exclude = opts?.excluirPasoVisualActual ?? null;
  return ETAPAS_VISUALES_OPERATIVAS.filter(
    (e) => exclude == null || e.pasoVisual !== exclude,
  ).map((e) => ({
    pasoVisual: e.pasoVisual,
    etapaInternaDestino: e.etapaInterna,
    label: `Paso ${e.pasoVisual} de ${TOTAL_PASOS_VISUALES_OPERATIVOS} — ${e.nombre}`,
  }));
}

/** @deprecated Usar `formatPasoOperativoLabel` (P105: Mesa = mismos 11 pasos). */
export function formatEtapaMesaLabel(
  etapaActual: number | null | undefined,
): string {
  return formatPasoOperativoLabel(etapaActual);
}

/** P105: Mesa ya no muestra correspondencia «En vista asesor…». */
export function formatEtapaMesaCorrespondenciaAsesor(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma estable P093
  etapaActual?: number | null,
): string | null {
  return null;
}

/** Etiqueta principal asesor (alias de la canónica compartida). */
export function formatEtapaAsesorPasoLabel(
  etapaActual: number | null | undefined,
): string {
  return formatPasoOperativoLabel(etapaActual);
}

/** Línea secundaria asesor → ancla al ID interno (solo Asesor). */
export function formatEtapaAsesorCorrespondenciaMesa(
  etapaActual: number | null | undefined,
): string {
  const c = getCorrespondenciaNumeracionEtapa(etapaActual);
  if (!c.numeracionDifiere) {
    return `Etapa interna ${c.etapaInterna} (misma numeración visible)`;
  }
  return `Etapa interna ${c.etapaInterna}`;
}

/** Badge bandeja Mesa: solo «Paso K de 11 — …» (sin hint). */
export function formatEtapaMesaBandejaBadge(
  etapaActual: number | null | undefined,
): { principal: string; hintAsesor: string | null } {
  return {
    principal: formatPasoOperativoLabel(etapaActual),
    hintAsesor: null,
  };
}

/** Opciones de filtro UI: 11 pasos; value = paso visual (string). */
export function opcionesFiltroPasoOperativo(): ReadonlyArray<{
  value: string;
  label: string;
}> {
  return ETAPAS_VISUALES_OPERATIVAS.map((e) => ({
    value: String(e.pasoVisual),
    label: `Paso ${e.pasoVisual} de ${TOTAL_PASOS_VISUALES_OPERATIVOS} — ${e.nombre}`,
  }));
}

/**
 * Resuelve valores internos a enviar al backend para un filtro de paso visual.
 * Paso 3 → [3, 4]; resto 1:1.
 */
export function etapasInternasParaFiltroPaso(
  pasoFilter: string,
): number[] | null {
  if (pasoFilter === "todas" || pasoFilter.trim() === "") return null;
  const paso = Number(pasoFilter);
  if (!Number.isFinite(paso)) return null;
  const list = etapasInternasParaPasoVisual(paso);
  return list.length > 0 ? list : null;
}

export {
  ETAPAS_VISUALES_OPERATIVAS,
  TOTAL_PASOS_VISUALES_OPERATIVOS,
  etapasInternasParaPasoVisual,
  mapEtapaInternaAPasoVisual,
};
