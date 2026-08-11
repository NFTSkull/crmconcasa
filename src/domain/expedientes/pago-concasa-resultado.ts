/**
 * Resultado operativo final de Pago ConCasa (etapa interna 12 / paso visual 11).
 * No implica movimiento bancario ni contable.
 */

export const PAGO_CONCASA_RESULTADOS = ["pagado", "no_pagado"] as const;

export type PagoConcasaResultado = (typeof PAGO_CONCASA_RESULTADOS)[number];

export function isPagoConcasaResultado(
  value: unknown,
): value is PagoConcasaResultado {
  return value === "pagado" || value === "no_pagado";
}

export function normalizePagoConcasaResultado(
  value: unknown,
): PagoConcasaResultado | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return isPagoConcasaResultado(v) ? v : null;
}

/** Copy amigable para UI (asesor / mesa). Nunca exponer `pagado`/`no_pagado` crudos. */
export function labelPagoConcasaResultado(
  resultado: PagoConcasaResultado | null | undefined,
): string | null {
  if (resultado === "pagado") return "Pagó";
  if (resultado === "no_pagado") return "No pagó";
  return null;
}

export function labelPagoConcasaResultadoConCheck(
  resultado: PagoConcasaResultado | null | undefined,
): string | null {
  if (resultado === "pagado") return "✓ Pagó";
  if (resultado === "no_pagado") return "No pagó";
  return null;
}

/** Badge listados: «Pago ConCasa · Pagó». */
export function formatPagoConcasaEtapaBadge(
  resultado: PagoConcasaResultado | null | undefined,
): string {
  const label = labelPagoConcasaResultado(resultado);
  if (!label) return "Pago ConCasa";
  return `Pago ConCasa · ${label}`;
}

export const MESA_PAGO_CONCASA_DECISION_COPY = {
  titulo: "Decisión Mesa",
  descripcion:
    "El expediente está en Firmado (etapa 11). Registra si el cliente realizó el pago a ConCasa. Ambas decisiones cierran en el paso final Pago ConCasa.",
  avisoCierre:
    "Esta decisión cerrará el expediente en Pago ConCasa. No registra movimientos bancarios ni modifica montos.",
  botonPagado: "Sí pagó",
  botonNoPagado: "No pagó",
  confirmPagado: "¿Confirmas que el cliente sí realizó el pago a ConCasa?",
  confirmNoPagado: "¿Confirmas que el cliente no realizó el pago a ConCasa?",
} as const;
