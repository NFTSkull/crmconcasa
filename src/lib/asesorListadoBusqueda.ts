/**
 * Búsqueda client-side del listado `/asesor`.
 * Conserva coincidencia por dígitos de NSS/teléfono (P088) sin que
 * un término sin dígitos haga match vacío (`"".includes("")` === true).
 */

export type AsesorBusquedaRow = Readonly<{
  cliente_nombre?: string | null;
  nss?: string | null;
  telefono_cliente?: string | null;
  programa?: string | null;
}>;

export function digitsOnly(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function matchesAsesorListadoBusqueda(
  row: AsesorBusquedaRow,
  rawTerm: string,
): boolean {
  const term = rawTerm.trim().toLowerCase();
  if (!term) return true;

  const nombre = (row.cliente_nombre ?? "").toLowerCase();
  if (nombre.includes(term)) return true;

  const programa = (row.programa ?? "").toLowerCase();
  if (programa.includes(term)) return true;

  const nssRaw = (row.nss ?? "").toLowerCase();
  if (nssRaw.includes(term)) return true;

  const termDigits = digitsOnly(term);
  if (termDigits) {
    if (digitsOnly(row.nss).includes(termDigits)) return true;
    if (digitsOnly(row.telefono_cliente).includes(termDigits)) return true;
  }

  return false;
}
