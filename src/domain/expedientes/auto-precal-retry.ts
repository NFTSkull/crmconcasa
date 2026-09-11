/**
 * Selección pura de candidatos a reintento auto-precal (sin I/O).
 * - Fallos técnicos (scraper_failed | infonavit_system_error) con cooldown base 5 min.
 * - Rachas de scraper_failed: cooldown 5 → 15 → 30 → 60 min (no martillar el mismo caso).
 * - Pendientes con **cero** filas en auto_precal_intentos si decision.created_at ≥ 10 min.
 * - Nunca ambiguous_payload / invalid_saldo / etc. por sí solos.
 * Sin tope de intentos totales (ilimitado mientras siga pendiente + razón reintentable).
 * Batch: 1 candidato/tick (cabe en maxDuration 300 con SCRAPER_TIMEOUT 150s).
 */

import { REASON_INFONAVIT_SYSTEM_ERROR } from "./auto-precalificar-decision";

export const AUTO_PRECAL_RETRY_MIN_AGE_MS = 5 * 60 * 1000;
/** Red de seguridad: pendiente sin ningún intento auto-precal. */
export const AUTO_PRECAL_ZERO_ATTEMPT_MIN_AGE_MS = 10 * 60 * 1000;
/** 1 candidato/tick: evita 2×timeout vs maxDuration 300 y libera slots del backlog. */
export const AUTO_PRECAL_RETRY_LIMIT = 1;

/**
 * Cooldown tras racha de `scraper_failed` consecutivos (más reciente primero).
 * Índice 0 = 1 falla, 1 = 2 fallas, 2 = 3, 3 = 4+.
 */
export const AUTO_PRECAL_SCRAPER_FAILED_BACKOFF_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
] as const;

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

/**
 * Cuenta `pending_error`+`scraper_failed` consecutivos desde el intento más reciente.
 * Cualquier otro resultado/razón corta la racha.
 */
export function consecutiveScraperFailedStreak(
  rows: AutoPrecalIntentoRow[],
): number {
  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.intentado_en) - Date.parse(a.intentado_en),
  );
  let streak = 0;
  for (const r of sorted) {
    if (r.resultado === "pending_error" && r.razon === "scraper_failed") {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

/** Cooldown efectivo según racha de scraper_failed (mínimo = base 5 min). */
export function cooldownMsForScraperFailedStreak(
  streak: number,
  baseMinAgeMs: number = AUTO_PRECAL_RETRY_MIN_AGE_MS,
): number {
  if (streak <= 0) return baseMinAgeMs;
  const idx = Math.min(streak, AUTO_PRECAL_SCRAPER_FAILED_BACKOFF_MS.length) - 1;
  return Math.max(baseMinAgeMs, AUTO_PRECAL_SCRAPER_FAILED_BACKOFF_MS[idx]!);
}

export type RetryCandidateInput = {
  /** Expedientes con editor_decisions.decision = 'pendiente' (y no deleted). */
  pendingExpedienteIds: string[];
  intentos: AutoPrecalIntentoRow[];
  /**
   * `editor_decisions.created_at` ISO por expediente (para bucket cero intentos).
   * Si falta para un id, ese id no entra al bucket cero-intentos.
   */
  pendingSinceById?: Record<string, string>;
  nowMs?: number;
  minAgeMs?: number;
  zeroAttemptMinAgeMs?: number;
  limit?: number;
};

/**
 * Filtra candidatos:
 * - al menos un intento pending_error + razón reintentable; cooldown según racha scraper_failed
 * - o 0 intentos y pending_since ≥ zeroAttemptMinAgeMs (10)
 * - orden: ancla temporal más antigua primero
 * - limit (default 1)
 */
export function selectAutoPrecalRetryCandidates(
  input: RetryCandidateInput,
): string[] {
  const nowMs = input.nowMs ?? Date.now();
  const minAgeMs = input.minAgeMs ?? AUTO_PRECAL_RETRY_MIN_AGE_MS;
  const zeroAttemptMinAgeMs =
    input.zeroAttemptMinAgeMs ?? AUTO_PRECAL_ZERO_ATTEMPT_MIN_AGE_MS;
  const limit = input.limit ?? AUTO_PRECAL_RETRY_LIMIT;

  const pending = new Set(input.pendingExpedienteIds);
  const pendingSinceById = input.pendingSinceById ?? {};
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

    const streak = consecutiveScraperFailedStreak(rows);
    const requiredAgeMs = cooldownMsForScraperFailedStreak(streak, minAgeMs);
    if (nowMs - lastMs < requiredAgeMs) continue;

    scored.push({ id, lastMs });
  }

  for (const id of pending) {
    if (byExp.has(id)) continue; // ya tuvo intentos (otra rama)
    const sinceRaw = pendingSinceById[id];
    if (!sinceRaw) continue;
    const sinceMs = Date.parse(sinceRaw);
    if (!Number.isFinite(sinceMs)) continue;
    if (nowMs - sinceMs < zeroAttemptMinAgeMs) continue;
    scored.push({ id, lastMs: sinceMs });
  }

  scored.sort((a, b) => a.lastMs - b.lastMs);
  return scored.slice(0, limit).map((s) => s.id);
}
