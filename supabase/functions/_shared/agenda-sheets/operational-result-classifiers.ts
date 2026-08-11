/**
 * Clasificadores de resultado operativo CITAS 2026 (Dashboard Bernardo).
 * Fuente: columnas E/F/I del Sheet — no agenda_bookings.status.
 *
 * BIOMETRICOS: E = BIOMETRICOS, F = NOTIFICACION, H = NOTAS (no override).
 * FIRMAS: E = NOTIFICACION, F = FIRMO, I = señal COMPLETO / FALTA ACUSE.
 */

export type OperationalResultClass =
  | "COMPLETED"
  | "FAILED_OR_NOT_ATTENDED"
  | "PENDING"
  | "UNKNOWN";

/** Normaliza texto operativo: trim, mayúsculas, sin acentos, espacios colapsados. */
export function normalizeSheetOpsText(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Positivos observados en col E (bloque BIOMETRICOS) — auditoría RO ≤2026-08-11. */
const BIOMETRIC_COMPLETED_EXACT = new Set([
  "CESI MTY",
  "CESI APODACA",
  "YA EN CESI",
]);

const NOTIF_FAILED_EXACT = new Set([
  "X",
  "NO",
  "NO ASISTIO",
  "ERROR EN HUELLAS",
]);

const SIGNATURE_FAILED_SUBSTRINGS = [
  "FALTA ACUSE",
  "NO ASISTIO",
  "NO FIRMO",
  "REAGENDA",
] as const;

/**
 * Biométricos (col E del bloque BIOMETRICOS).
 * Notas (H) no convierten X en completado.
 */
export function classifyBiometricResult(
  raw: string | null | undefined,
): OperationalResultClass {
  const n = normalizeSheetOpsText(raw);
  if (!n) return "PENDING";
  if (n === "X") return "FAILED_OR_NOT_ATTENDED";
  if (BIOMETRIC_COMPLETED_EXACT.has(n)) return "COMPLETED";
  // Variantes con CESI (p.ej. "CESI", "YA EN CESI MTY") vistas o plausibles.
  if (/\bCESI\b/.test(n) && !/\bX\b/.test(n)) return "COMPLETED";
  if (
    n.includes("NO ASIST") ||
    n.includes("NO PASARON") ||
    n.includes("REAGENDA")
  ) {
    return "FAILED_OR_NOT_ATTENDED";
  }
  return "UNKNOWN";
}

/**
 * Notificación a registro (col F del bloque BIOMETRICOS).
 * Independiente del resultado biométrico.
 */
export function classifyNotificationResult(
  raw: string | null | undefined,
): OperationalResultClass {
  const n = normalizeSheetOpsText(raw);
  if (!n) return "PENDING";
  if (NOTIF_FAILED_EXACT.has(n) || n.startsWith("REAGENDA")) {
    return "FAILED_OR_NOT_ATTENDED";
  }
  // Destinatario / confirmación operativa (auditoría histórica).
  if (n === "SI" || n === "YA CON BETTY" || /^BETTY(\s+\d+)?$/.test(n)) {
    return "COMPLETED";
  }
  // CESI* en F = valor de biométricos mal colocado — no contar como notificación.
  if (/\bCESI\b/.test(n)) return "UNKNOWN";
  return "UNKNOWN";
}

/**
 * Firma completa: señal canónica en col I (derecha de FIRMA).
 * COMPLETO ✔ → completed; FALTA ACUSE → no; vacío → pending.
 * BETTY / YA CON BETTY en E/F NO implican firma completa.
 */
export function classifySignatureResult(
  rawColI: string | null | undefined,
): OperationalResultClass {
  const n = normalizeSheetOpsText(rawColI);
  if (!n) return "PENDING";
  if (n.includes("COMPLETO")) return "COMPLETED";
  for (const frag of SIGNATURE_FAILED_SUBSTRINGS) {
    if (n.includes(frag)) return "FAILED_OR_NOT_ATTENDED";
  }
  return "UNKNOWN";
}

export function isOperationalCompleted(
  cls: OperationalResultClass,
): boolean {
  return cls === "COMPLETED";
}

export function operationalResultLabel(
  cls: OperationalResultClass,
): string {
  switch (cls) {
    case "COMPLETED":
      return "Completado";
    case "FAILED_OR_NOT_ATTENDED":
      return "No realizado";
    case "PENDING":
      return "Pendiente";
    default:
      return "Sin clasificar";
  }
}
