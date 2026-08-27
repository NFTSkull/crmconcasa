/**
 * Helpers puros del mapeo auto-precalificar (sin I/O).
 * Usados por la route y por tests aislados.
 */
export type AutoPrecalScraperPayload = {
  califica?: boolean;
  success?: boolean;
  error?: string;
  datos?: { saldoSubcuenta?: string | number | null };
  razon?: string;
  mensaje?: string;
};

export type AutoPrecalDecision =
  | { kind: "aprobado"; monto: number }
  | { kind: "no_cumple" }
  | { kind: "pending_error"; reason: string };

export function parseSaldoSubcuenta(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Mapeo estricto: solo califica===true / ===false; resto pending_error.
 * No invoca RPC (solo decide).
 */
export function decideAutoPrecalFromScraper(
  payload: AutoPrecalScraperPayload,
  upstreamOk: boolean,
): AutoPrecalDecision {
  if (!upstreamOk || typeof payload?.error === "string") {
    return { kind: "pending_error", reason: "scraper_failed" };
  }
  if (payload.califica === true) {
    const monto = parseSaldoSubcuenta(payload.datos?.saldoSubcuenta);
    if (monto == null || monto <= 0) {
      return { kind: "pending_error", reason: "invalid_saldo" };
    }
    return { kind: "aprobado", monto };
  }
  if (payload.califica === false) {
    return { kind: "no_cumple" };
  }
  return { kind: "pending_error", reason: "ambiguous_payload" };
}
