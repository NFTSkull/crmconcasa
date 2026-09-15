/**
 * Propuesta de mejoramiento P189.
 *
 * Regla de negocio v5:
 * - Carta Bajo Protesta y Presupuesto deben imprimir EXACTAMENTE la misma frase.
 * - Solo una mejora, corta y de un renglón.
 * - Si el monto aprobado es > $100,000: paneles solares.
 * - Hasta $100,000: una mejora razonable elegida de forma determinística por seed.
 *
 * Sin LLM / APIs. No afirma que los trabajos ya se realizaron.
 */

const MEJORAS_HASTA_40K = [
  "Pintura interior de la vivienda.",
  "Impermeabilización de azotea.",
  "Reparación de instalación hidráulica.",
  "Renovación de instalación eléctrica.",
  "Cambio de puertas y cerraduras.",
] as const;

const MEJORAS_40K_100K = [
  "Renovación de piso cerámico.",
  "Mejora de baño y grifería.",
  "Mejora de cocina y tarja.",
  "Instalación de tinaco y bomba.",
  "Cambio de calentador de agua.",
  "Rehabilitación de fachada.",
  "Mejora de ventanas y cancelería.",
  "Impermeabilización de azotea.",
] as const;

export const PROPUESTA_MAYOR_100K = "Instalación de paneles solares." as const;

export type PropuestaMejoramientoBanda =
  | "hasta_40000"
  | "40000_100000"
  | "mayor_100000";

export function bandaPropuestaMejoramiento(
  montoMejoravit: number,
): PropuestaMejoramientoBanda {
  if (montoMejoravit <= 40000) return "hasta_40000";
  if (montoMejoravit <= 100000) return "40000_100000";
  return "mayor_100000";
}

/** Hash pequeño y estable; solo se usa para escoger una frase del catálogo. */
function stableIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

export function lineasPropuestaMejoramiento(
  montoMejoravit: number,
  seed = String(montoMejoravit),
): readonly string[] {
  const banda = bandaPropuestaMejoramiento(montoMejoravit);
  if (banda === "mayor_100000") return [PROPUESTA_MAYOR_100K];

  const catalogo = banda === "hasta_40000" ? MEJORAS_HASTA_40K : MEJORAS_40K_100K;
  return [catalogo[stableIndex(seed, catalogo.length)]];
}

/**
 * Texto listo para Carta §IV y Presupuesto "breve descripción".
 * Devuelve una sola frase y nunca contiene saltos de línea.
 */
export function buildPropuestaMejoramiento(
  montoMejoravit: number | null | undefined,
  seed?: string,
): string {
  if (
    montoMejoravit === null ||
    montoMejoravit === undefined ||
    !Number.isFinite(montoMejoravit) ||
    montoMejoravit <= 0
  ) {
    return "";
  }
  return lineasPropuestaMejoramiento(montoMejoravit, seed).join("");
}
