import type { AutoPrecalScraperPayload } from "./auto-precalificar-decision";

export type AutoPrecalImmediateRetryKind =
  | "login_rejected"
  | "browser_lifecycle";

/**
 * Allowlist estrecha de fallos observados en Production que son técnicos y
 * transitorios. Todo lo no reconocido conserva el fallback actual del cron.
 */
export function classifyAutoPrecalImmediateRetry(
  payload: AutoPrecalScraperPayload,
): AutoPrecalImmediateRetryKind | null {
  if (typeof payload?.error !== "string") return null;

  const raw = payload.error.trim();
  if (!raw) return null;

  const normalized = raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

  if (normalized.includes("login fallido despues de 3 intentos")) {
    return "login_rejected";
  }

  const browserLifecyclePatterns = [
    "browsertype.launch",
    "target page, context or browser has been closed",
    "target closed",
    "targetcloseerror",
    "session closed",
    "browser has disconnected",
    "browser disconnected",
  ] as const;

  if (browserLifecyclePatterns.some((pattern) => normalized.includes(pattern))) {
    return "browser_lifecycle";
  }

  return null;
}
