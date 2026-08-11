/**
 * Clasificadores de resultado operativo CITAS 2026 (Dashboard Bernardo).
 * Fuente: columnas operativas del Sheet — no agenda_bookings.status.
 *
 * BIOMETRICOS: E = BIOMETRICOS, F = NOTIFICACION, H = NOTAS (no override).
 * FIRMAS: E = NOTIFICACION, F = FIRMO, G = FIRMA.
 *   COMPLETO / FALTA ACUSE en notas (H/I) NO confirman ni niegan firma.
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

/** FIRMO / FIRMA: señales inequívocas de no firmó / no asistió. */
const SIGNATURE_FAILED_EXACT = new Set([
  "X",
  "NO",
  "NO ASISTIO",
  "NO FIRMO",
]);

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

function isSignatureFailedToken(n: string): boolean {
  if (!n) return false;
  if (SIGNATURE_FAILED_EXACT.has(n)) return true;
  if (n.startsWith("REAGENDA")) return true;
  if (n.includes("NO ASIST")) return true;
  if (n.includes("NO FIRMO")) return true;
  return false;
}

/**
 * Firma ejecutada (bloque FIRMAS):
 * - Col F = FIRMO (señal canónica única para COMPLETED)
 * - Col G = FIRMA (información adicional; NO es requisito)
 *
 * COMPLETED solo si FIRMO === "SI".
 * NO cuentan: YA CON BETTY, BETTY, COMPLETO✔ en notas, FALTA ACUSE solo,
 * columna FIRMA sola, NOTIFICACION, color.
 */
export function classifySignatureResult(
  firmoRaw: string | null | undefined,
  firmaRaw?: string | null | undefined,
): OperationalResultClass {
  const firmo = normalizeSheetOpsText(firmoRaw);
  void firmaRaw; // info adicional; no decide COMPLETED

  if (!firmo) return "PENDING";

  if (isSignatureFailedToken(firmo)) {
    return "FAILED_OR_NOT_ATTENDED";
  }

  if (firmo === "SI") {
    return "COMPLETED";
  }

  // En tránsito operativo (p.ej. YA CON BETTY) — aún no firmó.
  if (firmo === "YA CON BETTY" || /^BETTY(\s+\d+)?$/.test(firmo)) {
    return "PENDING";
  }

  return "UNKNOWN";
}

/** Raw canónico para proyección/detalle: FIRMO (+ FIRMA si hay). */
export function formatSignatureResultRaw(
  firmoRaw: string | null | undefined,
  firmaRaw?: string | null | undefined,
): string | null {
  const firmo = String(firmoRaw ?? "").trim();
  const firma = String(firmaRaw ?? "").trim();
  if (!firmo && !firma) return null;
  if (firmo && firma) return `${firmo} / ${firma}`;
  return firmo || firma;
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
