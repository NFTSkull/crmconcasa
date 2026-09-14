/**
 * Selección pura de candidatos a reintento auto-reprecal (sin I/O).
 * Espejo de auto-precal-retry: scraper_failed | infonavit_system_error;
 * rescata pendientes sin intentos tras el cooldown; nunca ambiguous_payload por sí solo.
 * Sin tope de intentos totales (ilimitado mientras siga pendiente + razón reintentable).
 */

import { isAutoPrecalRetryablePendingReason } from "./auto-precal-retry";

export const AUTO_REPRECAL_RETRY_MIN_AGE_MS = 5 * 60 * 1000;
/** 2 candidatos/tick (riesgo OOM aceptado en Railway 1GB hasta upgrade de plan). */
export const AUTO_REPRECAL_RETRY_LIMIT = 2;

export type AutoReprecalIntentoRow = {
  intento_id: string;
  intentado_en: string;
  resultado: string;
  razon: string | null;
};

export type ReprecalRetryCandidateInput = {
  /** Intentos con expediente_precalificacion_intentos.decision = 'pendiente'. */
  pendingIntentoIds: string[];
  intentos: AutoReprecalIntentoRow[];
  /** Fecha de creación real del intento pendiente; necesaria para rescatar cero intentos. */
  pendingSinceById?: Record<string, string>;
  nowMs?: number;
  minAgeMs?: number;
  limit?: number;
};

/**
 * Filtra candidatos:
 * - al menos un intento pending_error + razón reintentable
 * - sin tope de intentos totales (ambiguous_payload solo nunca entra por sí mismo)
 * - último intento hace ≥ minAgeMs (default 5 min)
 * - sin intentos: creación hace ≥ minAgeMs; fecha ausente/inválida excluye
 * - orden: último intento más antiguo primero
 * - limit (default 2)
 */
export function selectAutoReprecalRetryCandidates(
  input: ReprecalRetryCandidateInput,
): string[] {
  const nowMs = input.nowMs ?? Date.now();
  const minAgeMs = input.minAgeMs ?? AUTO_REPRECAL_RETRY_MIN_AGE_MS;
  const limit = input.limit ?? AUTO_REPRECAL_RETRY_LIMIT;

  const pending = new Set(input.pendingIntentoIds);
  const byIntento = new Map<string, AutoReprecalIntentoRow[]>();

  for (const row of input.intentos) {
    if (!pending.has(row.intento_id)) continue;
    const list = byIntento.get(row.intento_id) ?? [];
    list.push(row);
    byIntento.set(row.intento_id, list);
  }

  const scored: { id: string; lastMs: number }[] = [];

  for (const [id, rows] of byIntento) {
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

  for (const id of pending) {
    // Cualquier historial real mantiene las reglas anteriores; no convertir
    // una respuesta ambigua o un fallo de RPC en un caso de cero intentos.
    if (byIntento.has(id)) continue;
    const since = input.pendingSinceById?.[id];
    if (!since) continue;
    const sinceMs = Date.parse(since);
    if (!Number.isFinite(sinceMs) || nowMs - sinceMs < minAgeMs) continue;
    scored.push({ id, lastMs: sinceMs });
  }

  scored.sort((a, b) => a.lastMs - b.lastMs);
  return scored.slice(0, limit).map((s) => s.id);
}
