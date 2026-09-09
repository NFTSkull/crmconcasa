/**
 * Selección pura de candidatos a reintento auto-precal (sin I/O).
 * Solo reintenta fallos técnicos (scraper_failed | infonavit_system_error);
 * nunca backlog sin intentos ni ambiguous_payload / invalid_saldo / etc.
 * Sin tope de intentos totales (ilimitado mientras siga pendiente + razón reintentable).
 */

import { REASON_INFONAVIT_SYSTEM_ERROR } from "./auto-precalificar-decision";

export const AUTO_PRECAL_RETRY_MIN_AGE_MS = 5 * 60 * 1000;
/** 1 candidato/tick: 1 Playwright a la vez dentro del cron (Railway 1GB). */
export const AUTO_PRECAL_RETRY_LIMIT = 1;

/** Razones pending_error elegibles para cron de reintento. */
export const AUTO_PRECAL_RETRYABLE_PENDING_REASONS = new Set<string>([
  "scraper_failed",
  REASON_INFONAVIT_SYSTEM_ERROR,
]);

export function isAutoPrecalRetryablePendingReason(
  razon: string | null | undefined,
): boolean {
  return (
    typeof razon === "string" &&
    AUTO_PRECAL_RETRYABLE_PENDING_REASONS.has(razon)
  );
}

export type AutoPrecalIntentoRow = {
  expediente_id: string;
  intentado_en: string;
  resultado: string;
  razon: string | null;
};

export type RetryCandidateInput = {
  /** Expedientes con editor_decisions.decision = 'pendiente' (y no deleted). */
  pendingExpedienteIds: string[];
  intentos: AutoPrecalIntentoRow[];
  nowMs?: number;
  minAgeMs?: number;
  limit?: number;
};

/**
 * Filtra candidatos:
 * - al menos un intento pending_error + razón reintentable
 * - sin tope de intentos totales (ambiguous_payload solo nunca entra por sí mismo)
 * - último intento hace ≥ minAgeMs (default 5 min)
 * - orden: último intento más antiguo primero
 * - limit (default 1)
 */
export function selectAutoPrecalRetryCandidates(
  input: RetryCandidateInput,
): string[] {
  const nowMs = input.nowMs ?? Date.now();
  const minAgeMs = input.minAgeMs ?? AUTO_PRECAL_RETRY_MIN_AGE_MS;
  const limit = input.limit ?? AUTO_PRECAL_RETRY_LIMIT;

  const pending = new Set(input.pendingExpedienteIds);
  const byExp = new Map<string, AutoPrecalIntentoRow[]>();

  for (const row of input.intentos) {
    if (!pending.has(row.expediente_id)) continue;
    const list = byExp.get(row.expediente_id) ?? [];
    list.push(row);
    byExp.set(row.expediente_id, list);
  }

  const scored: { id: string; lastMs: number }[] = [];

  for (const [id, rows] of byExp) {
    const hasRetryable = rows.some(
      (r) =>
        r.resultado === "pending_error" &&
        isAutoPrecalRetryablePendingReason(r.razon),
    );
    if (!hasRetryable) continue;

    let lastMs = 0;
    for (const r of rows) {
      const t = Date.parse(r.intentado_en);
      if (Number.isFinite(t) && t > lastMs) lastMs = t;
    }
    if (lastMs === 0) continue;
    if (nowMs - lastMs < minAgeMs) continue;

    scored.push({ id, lastMs });
  }

  scored.sort((a, b) => a.lastMs - b.lastMs);
  return scored.slice(0, limit).map((s) => s.id);
}
