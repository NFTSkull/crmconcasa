/**
 * Detector P175: notificación (col F bio) pide reagendar inscripción.
 * Normalización alineada a operational-result-classifiers (NFD, upper, espacios).
 */

function normalizeOpsText(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * true solo si el texto normalizado incluye REAGENDA y el token INSCRIP
 * (cubre REAGENDA INSCRIPCION / INSCRIPCIÓN / … FALLA SISTEMA).
 * false para REAGENDA BIOMETRICOS/FIRMA, REAGENDA solo, INSCRIPCION sin REAGENDA, vacío, X, BETTY.
 */
export function detectInscripcionRebookRequirement(
  notificationRaw: string | null | undefined,
): boolean {
  const n = normalizeOpsText(notificationRaw);
  if (!n) return false;
  return n.includes("REAGENDA") && n.includes("INSCRIP");
}
