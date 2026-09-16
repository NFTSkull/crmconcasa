/**
 * Generador DETERMINÍSTICO de propuesta de mejoramiento.
 * Una sola mejora por documento, alineada a categorías admitidas por Mejoravit.
 * Sin LLM / APIs / aleatoriedad y sin afirmar que el trabajo ya se realizó.
 *
 * Regla de negocio:
 * - hasta $30k: resanes/pintura;
 * - $30k–$60k: impermeabilización/humedad;
 * - $60k–$80k: pisos/recubrimientos;
 * - $80k–$100k: baño/grifería;
 * - > $100k: sistema fotovoltaico con paneles solares.
 */

export const PROPUESTA_HASTA_30000 =
  "Resanes y aplicación de pintura interior y exterior.";
export const PROPUESTA_30000_60000 =
  "Impermeabilización y reparación de áreas con humedad.";
export const PROPUESTA_60000_80000 =
  "Renovación de pisos cerámicos, adhesivos y recubrimientos.";
export const PROPUESTA_80000_100000 =
  "Mejoras de baño con grifería, sanitario y accesorios.";
export const PROPUESTA_MAS_100000 =
  "Instalación de sistema fotovoltaico con paneles solares.";

export type PropuestaMejoramientoBanda =
  | "hasta_30000"
  | "30000_60000"
  | "60000_80000"
  | "80000_100000"
  | "mas_100000";

export function bandaPropuestaMejoramiento(
  montoMejoravit: number,
): PropuestaMejoramientoBanda {
  if (montoMejoravit <= 30000) return "hasta_30000";
  if (montoMejoravit <= 60000) return "30000_60000";
  if (montoMejoravit <= 80000) return "60000_80000";
  if (montoMejoravit <= 100000) return "80000_100000";
  return "mas_100000";
}

export function lineasPropuestaMejoramiento(
  montoMejoravit: number,
): readonly string[] {
  switch (bandaPropuestaMejoramiento(montoMejoravit)) {
    case "hasta_30000":
      return [PROPUESTA_HASTA_30000];
    case "30000_60000":
      return [PROPUESTA_30000_60000];
    case "60000_80000":
      return [PROPUESTA_60000_80000];
    case "80000_100000":
      return [PROPUESTA_80000_100000];
    case "mas_100000":
      return [PROPUESTA_MAS_100000];
  }
}

/**
 * Texto listo para Carta §IV y Presupuesto "breve descripción".
 * Siempre devuelve una sola línea y ambos documentos reciben la misma cadena.
 */
export function buildPropuestaMejoramiento(
  montoMejoravit: number | null | undefined,
): string {
  if (
    montoMejoravit === null ||
    montoMejoravit === undefined ||
    !Number.isFinite(montoMejoravit) ||
    montoMejoravit <= 0
  ) {
    return "";
  }
  return lineasPropuestaMejoramiento(montoMejoravit)[0] ?? "";
}
