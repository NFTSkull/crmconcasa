/**
 * Normaliza el nombre que devuelve el scraper Infonavit antes de persistirlo.
 * El portal upstream representa Ñ como # en algunos nombres (PI#A, MU#OZ, etc.).
 * Fail-closed: después de corregir ese artefacto, solo acepta caracteres de persona.
 */
export function normalizeInfonavitScraperPersonName(
  input: string | null | undefined,
): string | null {
  const normalized = String(input ?? "")
    .replace(/#/g, "Ñ")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) return null;
  if (!/^[\p{L}\p{M}\s'\u2019-]+$/u.test(normalized)) return null;
  return normalized;
}
