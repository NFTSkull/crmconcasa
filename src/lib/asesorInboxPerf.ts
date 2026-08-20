/**
 * P203: summary asesor — single-flight + política de refresh.
 * Summary es global del asesor (no depende de page ni quickFilter).
 */

export const ASESOR_INBOX_FOCUS_TTL_MS = 45_000;

export type AsesorSummaryRefreshReason =
  | "initial"
  | "mutation"
  | "explicit"
  | "focus"
  | "realtime";

/** ¿Debe pedirse summary por esta razón (sin mirar TTL)? */
export function asesorSummaryReasonRequiresFetch(
  reason: AsesorSummaryRefreshReason,
): boolean {
  return (
    reason === "initial" ||
    reason === "mutation" ||
    reason === "explicit" ||
    reason === "realtime" ||
    reason === "focus"
  );
}

/** Focus/visibility: solo si pasó el TTL desde el último summary OK. */
export function shouldRefreshAsesorSummaryOnFocus(opts: {
  lastSummaryAtMs: number;
  nowMs: number;
  ttlMs?: number;
}): boolean {
  const ttl = opts.ttlMs ?? ASESOR_INBOX_FOCUS_TTL_MS;
  if (opts.lastSummaryAtMs <= 0) return true;
  return opts.nowMs - opts.lastSummaryAtMs >= ttl;
}

export function shouldRefreshAsesorListOnFocus(opts: {
  lastListAtMs: number;
  nowMs: number;
  ttlMs?: number;
}): boolean {
  const ttl = opts.ttlMs ?? ASESOR_INBOX_FOCUS_TTL_MS;
  if (opts.lastListAtMs <= 0) return true;
  return opts.nowMs - opts.lastListAtMs >= ttl;
}

/**
 * Single-flight: si ya hay un summary en vuelo para la misma key,
 * reutiliza la misma Promise (no dispara 2 RPC).
 */
export function createAsesorSummarySingleFlight<T>() {
  let inFlight: Promise<T> | null = null;
  let inFlightKey = "";

  return {
    run(key: string, factory: () => Promise<T>): Promise<T> {
      const k = String(key ?? "").trim();
      if (inFlight && inFlightKey === k) return inFlight;
      inFlightKey = k;
      const p = factory().finally(() => {
        if (inFlight === p) {
          inFlight = null;
          inFlightKey = "";
        }
      });
      inFlight = p;
      return p;
    },
    /** Solo tests / debug. */
    getInFlightForTests(): Promise<T> | null {
      return inFlight;
    },
  };
}

/** DEV-only: marks de performance sin PII. */
export function asesorPerfMark(name: string): void {
  if (process.env.NODE_ENV !== "development") return;
  try {
    performance.mark(`p203-asesor:${name}`);
  } catch {
    /* ignore */
  }
}

export function asesorPerfMeasure(name: string, start: string, end: string): void {
  if (process.env.NODE_ENV !== "development") return;
  try {
    performance.measure(`p203-asesor:${name}`, `p203-asesor:${start}`, `p203-asesor:${end}`);
  } catch {
    /* ignore */
  }
}

export function mesaPerfMark(name: string): void {
  if (process.env.NODE_ENV !== "development") return;
  try {
    performance.mark(`p203-mesa:${name}`);
  } catch {
    /* ignore */
  }
}
