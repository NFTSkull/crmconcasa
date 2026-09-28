import {
  REASON_AKAMAI_ACCESS_DENIED,
  REASON_INFONAVIT_SYSTEM_ERROR,
} from "./auto-precalificar-decision";

export const AUTO_PRECAL_AKAMAI_ALERT_MAX_AGE_MS = 5 * 60 * 1000;
export const AUTO_PRECAL_SCRAPER_FAILURE_ALERT_THRESHOLD = 3;

export type AutoPrecalHealthEvent = Readonly<{
  intentado_en: string;
  resultado: string;
  razon: string | null;
}>;

export type AutoPrecalHealthState = Readonly<{
  blockedByAkamai: boolean;
  portalUnavailable: boolean;
  detectedAt: string | null;
  reason: string | null;
}>;

function isTerminalResult(resultado: string): boolean {
  return resultado === "aprobado" || resultado === "no_cumple";
}

function isPortalFailureReason(reason: string | null): boolean {
  return (
    reason === REASON_AKAMAI_ACCESS_DENIED ||
    reason === REASON_INFONAVIT_SYSTEM_ERROR ||
    reason === "scraper_failed"
  );
}

/**
 * Estado de disponibilidad de Bansefi/Infonavit para la precalificación automática.
 *
 * Reglas conservadoras:
 * - ignora leases `job_started`;
 * - Akamai o un error explícito de sistema en el evento técnico más reciente
 *   encienden la alerta inmediatamente;
 * - `scraper_failed` solo enciende la alerta tras 3 fallas técnicas
 *   consecutivas recientes, para no confundir un fallo aislado con una caída;
 * - cualquier resultado terminal posterior (aprobado/no_cumple) apaga la alerta;
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
    return {
      blockedByAkamai: false,
      portalUnavailable: false,
      detectedAt: null,
      reason: null,
    };
  }

  if (nowMs - latest.atMs > maxAgeMs) {
    return {
      blockedByAkamai: false,
      portalUnavailable: false,
      detectedAt: null,
      reason: null,
    };
  }

  if (isTerminalResult(latest.event.resultado)) {
    return {
      blockedByAkamai: false,
      portalUnavailable: false,
      detectedAt: null,
      reason: null,
    };
  }

  const blockedByAkamai =
    latest.event.resultado === "pending_error" &&
    latest.event.razon === REASON_AKAMAI_ACCESS_DENIED;

  if (blockedByAkamai) {
    return {
      blockedByAkamai: true,
      portalUnavailable: true,
      detectedAt: latest.event.intentado_en,
      reason: REASON_AKAMAI_ACCESS_DENIED,
    };
  }

  if (
    latest.event.resultado === "pending_error" &&
    latest.event.razon === REASON_INFONAVIT_SYSTEM_ERROR
  ) {
    return {
      blockedByAkamai: false,
      portalUnavailable: true,
      detectedAt: latest.event.intentado_en,
      reason: REASON_INFONAVIT_SYSTEM_ERROR,
    };
  }

  if (
    latest.event.resultado === "pending_error" &&
    latest.event.razon === "scraper_failed"
  ) {
    let consecutiveFailures = 0;
    for (const item of ordered) {
      if (nowMs - item.atMs > maxAgeMs) break;
      if (isTerminalResult(item.event.resultado)) break;
      if (
        item.event.resultado === "pending_error" &&
        isPortalFailureReason(item.event.razon)
      ) {
        consecutiveFailures += 1;
        if (
          consecutiveFailures >= AUTO_PRECAL_SCRAPER_FAILURE_ALERT_THRESHOLD
        ) {
          return {
            blockedByAkamai: false,
            portalUnavailable: true,
            detectedAt: latest.event.intentado_en,
            reason: "sustained_scraper_failure",
          };
        }
        continue;
      }
      break;
    }
  }

  return {
    blockedByAkamai: false,
    portalUnavailable: false,
    detectedAt: null,
    reason: null,
  };
}
