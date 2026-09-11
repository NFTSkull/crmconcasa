export const ANETTE_NSS_ONLY_EMAIL = "anette.perez@concasa.mx" as const;

const NSS_RE = /^\d{11}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAnetteNssOnlyEmail(
  email: string | null | undefined,
): boolean {
  return String(email ?? "").trim().toLowerCase() === ANETTE_NSS_ONLY_EMAIL;
}

export function normalizeAnetteNssOnlyInput(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function validateAnetteNssOnlyInput(raw: string): string {
  const nss = normalizeAnetteNssOnlyInput(raw);
  if (!NSS_RE.test(nss)) {
    throw new Error("El NSS (IMSS) debe tener exactamente 11 dígitos.");
  }
  return nss;
}

export type AnetteNssOnlyPrepareResult = Readonly<{
  action: "created" | "reprecal";
  expedienteId: string;
  intentoId: string | null;
}>;

export function parseAnetteNssOnlyPrepareResult(
  raw: unknown,
): AnetteNssOnlyPrepareResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const action = value.action;
  if (action !== "created" && action !== "reprecal") return null;

  const expedienteId = String(value.expediente_id ?? value.id ?? "").trim();
  if (!UUID_RE.test(expedienteId)) return null;

  const intentoRaw = String(value.intento_id ?? "").trim();
  const intentoId = intentoRaw && UUID_RE.test(intentoRaw) ? intentoRaw : null;
  if (action === "reprecal" && !intentoId) return null;

  return { action, expedienteId, intentoId };
}
