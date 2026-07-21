/**
 * P093 B2 — Correspondencia de numeración Mesa (etapa interna 1–12)
 * vs Asesor (paso visual 1–11, omite etapa legacy 4).
 * Solo presentación; no muta `etapa_actual` ni IDs.
 */

import {
  getEtapaOperativaNombre,
  getEtapaVisualNombre,
  mapEtapaInternaAPasoVisual,
  resolveEtapaActualOperativa,
  TOTAL_PASOS_VISUALES_OPERATIVOS,
} from "./asesor-seguimiento-operativo";

export type CorrespondenciaNumeracionEtapa = Readonly<{
  etapaInterna: number;
  pasoVisual: number;
  /** Nombre según vista Mesa (catálogo interno 1–12). */
  nombreMesa: string;
  /** Nombre según timeline visual del asesor. */
  nombreAsesor: string;
  /** true cuando el número de Mesa y el paso del asesor no coinciden. */
  numeracionDifiere: boolean;
}>;

export const NOTA_NUMERACION_ETAPAS =
  "Mesa usa la etapa interna 1–12. El asesor muestra 11 pasos (omite la etapa legacy 4). Ambos leen el mismo `etapa_actual`.";

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

/** Etiqueta principal Mesa: «Etapa 5 — Biometría (resultado)». */
export function formatEtapaMesaLabel(
  etapaActual: number | null | undefined,
): string {
  const c = getCorrespondenciaNumeracionEtapa(etapaActual);
  return `Etapa ${c.etapaInterna} — ${c.nombreMesa}`;
}

/**
 * Línea secundaria Mesa → asesor. null si los números coinciden (etapas 1–3).
 */
export function formatEtapaMesaCorrespondenciaAsesor(
  etapaActual: number | null | undefined,
): string | null {
  const c = getCorrespondenciaNumeracionEtapa(etapaActual);
  if (!c.numeracionDifiere) return null;
  return `En vista asesor: paso ${c.pasoVisual} de ${TOTAL_PASOS_VISUALES_OPERATIVOS}`;
}

/** Etiqueta principal asesor: «Paso 4 de 11 — Biometría (resultado)». */
export function formatEtapaAsesorPasoLabel(
  etapaActual: number | null | undefined,
): string {
  const c = getCorrespondenciaNumeracionEtapa(etapaActual);
  return `Paso ${c.pasoVisual} de ${TOTAL_PASOS_VISUALES_OPERATIVOS} — ${c.nombreAsesor}`;
}

/** Línea secundaria asesor → Mesa (siempre, para anclar al ID interno). */
export function formatEtapaAsesorCorrespondenciaMesa(
  etapaActual: number | null | undefined,
): string {
  const c = getCorrespondenciaNumeracionEtapa(etapaActual);
  if (!c.numeracionDifiere) {
    return `Etapa interna ${c.etapaInterna} (misma numeración que Mesa)`;
  }
  return `Etapa interna ${c.etapaInterna} (la misma que muestra Mesa)`;
}

/** Badge compacto bandeja Mesa: «Etapa 5: Biometría…» + hint opcional. */
export function formatEtapaMesaBandejaBadge(
  etapaActual: number | null | undefined,
): { principal: string; hintAsesor: string | null } {
  const c = getCorrespondenciaNumeracionEtapa(etapaActual);
  return {
    principal: `Etapa ${c.etapaInterna}: ${c.nombreMesa}`,
    hintAsesor: c.numeracionDifiere
      ? `paso ${c.pasoVisual}/${TOTAL_PASOS_VISUALES_OPERATIVOS} asesor`
      : null,
  };
}
