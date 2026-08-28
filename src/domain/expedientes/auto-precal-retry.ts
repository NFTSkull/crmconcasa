/**
 * Selección pura de candidatos a reintento auto-precal (sin I/O).
 * Solo reintenta fallos técnicos scraper_failed; nunca backlog sin intentos.
 */

export const AUTO_PRECAL_RETRY_MAX_INTENTOS = 3;
export const AUTO_PRECAL_RETRY_MIN_AGE_MS = 5 * 60 * 1000;
export const AUTO_PRECAL_RETRY_LIMIT = 5;

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
  maxIntentos?: number;
  minAgeMs?: number;
  limit?: number;
};

/**
 * Filtra candidatos:
 * - al menos un intento pending_error + scraper_failed
 * - total intentos < maxIntentos (default 3)
 * - último intento hace ≥ minAgeMs (default 5 min)
 * - orden: último intento más antiguo primero
 * - limit (default 5)
 */
export function selectAutoPrecalRetryCandidates(
  input: RetryCandidateInput,
): string[] {
  const nowMs = input.nowMs ?? Date.now();
  const maxIntentos = input.maxIntentos ?? AUTO_PRECAL_RETRY_MAX_INTENTOS;
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
    const hasScraperFailed = rows.some(
      (r) =>
        r.resultado === "pending_error" && r.razon === "scraper_failed",
    );
    if (!hasScraperFailed) continue;
    if (rows.length >= maxIntentos) continue;

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
