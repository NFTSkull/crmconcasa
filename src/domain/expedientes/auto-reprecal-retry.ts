/**
 * Selección pura de candidatos a reintento auto-reprecal (sin I/O).
 * Espejo de auto-precal-retry: solo scraper_failed; nunca backlog sin intentos.
 * Sin tope de intentos totales (ilimitado mientras siga pendiente + scraper_failed).
 */

export const AUTO_REPRECAL_RETRY_MIN_AGE_MS = 5 * 60 * 1000;
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
  nowMs?: number;
  minAgeMs?: number;
  limit?: number;
};

/**
 * Filtra candidatos:
 * - al menos un intento pending_error + scraper_failed
 * - sin tope de intentos totales (ambiguous_payload solo nunca entra por sí mismo)
 * - último intento hace ≥ minAgeMs (default 5 min)
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
    const hasScraperFailed = rows.some(
      (r) =>
        r.resultado === "pending_error" && r.razon === "scraper_failed",
    );
    if (!hasScraperFailed) continue;

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
