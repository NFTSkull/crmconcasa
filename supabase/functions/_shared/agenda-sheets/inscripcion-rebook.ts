/**
 * Edge mirror P175 — detector REAGENDA + INSCRIP (col F biométricos).
 * Mantener en sync con src/domain/agenda-inscripcion/detect-rebook.ts.
 */

function normalizeOpsText(raw: string | null | undefined): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function detectInscripcionRebookRequirement(
  notificationRaw: string | null | undefined,
): boolean {
  const n = normalizeOpsText(notificationRaw);
  if (!n) return false;
  return n.includes("REAGENDA") && n.includes("INSCRIP");
}
