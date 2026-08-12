/**
 * Idempotency key para `asesor_iniciar_reprecalificacion` (P155/P164).
 * Misma estrategia que `/asesor/nueva`: una key por ciclo de submit;
 * se reusa en reintentos del mismo ciclo; se limpia tras éxito.
 */
export function newReprecalIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `reprecal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
