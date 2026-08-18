/**
 * Generador DETERMINÍSTICO de propuesta de mejoramiento P189.
 * Sin LLM / APIs / aleatoriedad. No afirma que los trabajos ya se realizaron.
 * Total del presupuesto = montoMejoravit (no precios por concepto).
 */

/** Banda 90,000.01–130,000 — caso $102,529.36 (4 líneas, ≤60 chars). */
export const PROPUESTA_BAND_90_130 = [
  "Resanes y aplicación de pintura interior y exterior.",
  "Impermeabilización y reparación de áreas con humedad.",
  "Renovación de pisos, azulejos y recubrimientos.",
  "Mantenimiento de instalaciones hidráulicas y eléctricas.",
] as const;

const BAND_HASTA_50 = [
  "Resanes y aplicación de pintura interior y exterior.",
  "Impermeabilización y reparación de áreas con humedad.",
  "Mantenimiento de instalaciones hidráulicas.",
] as const;

const BAND_50_90 = [
  "Resanes y aplicación de pintura interior y exterior.",
  "Impermeabilización y reparación de áreas con humedad.",
  "Renovación de pisos, azulejos y recubrimientos.",
] as const;

const BAND_130_169 = [
  "Resanes y pintura interior y exterior de mayor alcance.",
  "Impermeabilización integral y reparación de humedad.",
  "Renovación de pisos, azulejos y recubrimientos.",
  "Mejoras de baño y cocina sin afectación estructural.",
] as const;

export type PropuestaMejoramientoBanda =
  | "hasta_50000"
  | "50000_90000"
  | "90000_130000"
  | "130000_169000";

export function bandaPropuestaMejoramiento(
  montoMejoravit: number,
): PropuestaMejoramientoBanda {
  if (montoMejoravit <= 50000) return "hasta_50000";
  if (montoMejoravit <= 90000) return "50000_90000";
  if (montoMejoravit <= 130000) return "90000_130000";
  return "130000_169000";
}

export function lineasPropuestaMejoramiento(
  montoMejoravit: number,
): readonly string[] {
  switch (bandaPropuestaMejoramiento(montoMejoravit)) {
    case "hasta_50000":
      return BAND_HASTA_50;
    case "50000_90000":
      return BAND_50_90;
    case "90000_130000":
      return PROPUESTA_BAND_90_130;
    case "130000_169000":
      return BAND_130_169;
  }
}

/**
 * Texto listo para Carta §IV y Presupuesto "breve descripción".
 * Misma cadena en ambos documentos.
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
  return lineasPropuestaMejoramiento(montoMejoravit).join("\n");
}
