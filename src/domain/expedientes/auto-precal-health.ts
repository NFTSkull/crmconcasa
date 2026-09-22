import { REASON_AKAMAI_ACCESS_DENIED } from "./auto-precalificar-decision";

export const AUTO_PRECAL_AKAMAI_ALERT_MAX_AGE_MS = 5 * 60 * 1000;

export type AutoPrecalHealthEvent = Readonly<{
  intentado_en: string;
  resultado: string;
  razon: string | null;
}>;

export type AutoPrecalHealthState = Readonly<{
  blockedByAkamai: boolean;
  detectedAt: string | null;
}>;

/**
 * Alerta conservadora:
 * - ignora leases job_started;
 * - solo prende si el evento técnico más reciente es akamai_access_denied;
 * - una respuesta automática terminal posterior la apaga;
 * - eventos viejos no mantienen una alerta indefinida.
 */
export function resolveAutoPrecalHealth(
  events: readonly AutoPrecalHealthEvent[],
  nowMs: number = Date.now(),
  maxAgeMs: number = AUTO_PRECAL_AKAMAI_ALERT_MAX_AGE_MS,
): AutoPrecalHealthState {
  const ordered = [...events]
    .filter((event) => event.razon !== "job_started")
    .map((event) => ({ event, atMs: Date.parse(event.intentado_en) }))
    .filter((item) => Number.isFinite(item.atMs))
    .sort((a, b) => b.atMs - a.atMs);

  const latest = ordered[0];
  if (!latest) {
    return { blockedByAkamai: false, detectedAt: null };
  }

  if (nowMs - latest.atMs > maxAgeMs) {
    return { blockedByAkamai: false, detectedAt: null };
  }

  const blocked =
    latest.event.resultado === "pending_error" &&
    latest.event.razon === REASON_AKAMAI_ACCESS_DENIED;

  return {
    blockedByAkamai: blocked,
    detectedAt: blocked ? latest.event.intentado_en : null,
  };
}
