/**
 * P087 — Aportación al agregado Admin «Monto aprobado Mejoravit».
 *
 * No modifica el snapshot real (`monto_aprobado_al_aprobar`).
 * Solo limita la contribución de cada expediente al SUM/AVG administrativo.
 */

export const MONTO_MAXIMO_APORTACION_MEJORAVIT_ADMIN = 169_000;

/** Aportación de un snapshot al agregado Admin (tope por expediente). */
export function aportacionMontoAprobadoMejoravitAdmin(monto: number): number {
  return Math.min(monto, MONTO_MAXIMO_APORTACION_MEJORAVIT_ADMIN);
}
