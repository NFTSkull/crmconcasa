/**
 * P088 — Búsqueda del listado del asesor (`/asesor`).
 *
 * Helper puro para el buscador principal: nombre del cliente, NSS (completo,
 * parcial o con separadores), teléfono y programa.
 *
 * Regla clave: la comparación numérica (NSS/teléfono normalizados a dígitos)
 * solo ocurre cuando el término buscado contiene al menos un dígito. Sin esta
 * guarda, `"12345678901".includes("")` devuelve `true` y cualquier término
 * alfabético coincidiría con todos los registros.
 */

export type AsesorSearchableExpediente = Readonly<{
  cliente_nombre?: string | null;
  nss?: string | null;
  telefono_cliente?: string | null;
  programa?: string | null;
}>;

export function normalizeSearchText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("es-MX") : "";
}

export function onlySearchDigits(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "") : "";
}

export function matchesAsesorSearch(
  expediente: AsesorSearchableExpediente,
  search: string,
): boolean {
  const textTerm = normalizeSearchText(search);

  if (!textTerm) {
    return true;
  }

  const digitsTerm = onlySearchDigits(search);

  const clienteNombre = normalizeSearchText(expediente.cliente_nombre);
  const programa = normalizeSearchText(expediente.programa);
  const nssText = normalizeSearchText(expediente.nss);
  const nssDigits = onlySearchDigits(expediente.nss);
  const telefonoDigits = onlySearchDigits(expediente.telefono_cliente);

  return (
    clienteNombre.includes(textTerm) ||
    programa.includes(textTerm) ||
    nssText.includes(textTerm) ||
    (digitsTerm.length > 0 &&
      (nssDigits.includes(digitsTerm) || telefonoDigits.includes(digitsTerm)))
  );
}

/** Aplica la búsqueda sobre la lista completa (antes de filtros y paginación). */
export function filterAsesorListBySearch<T extends AsesorSearchableExpediente>(
  list: readonly T[],
  search: string,
): T[] {
  const term = normalizeSearchText(search);
  if (!term) return [...list];
  return list.filter((p) => matchesAsesorSearch(p, search));
}
