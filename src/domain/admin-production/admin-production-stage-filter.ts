/**
 * Producción Admin: conteo de etapa seleccionada desde `row.etapas` (periodo).
 * No inventa métricas de precal por etapa.
 */

import type { AdminAsesorProductionRow } from "./repo";
import { etapaActualesFromAdminPasoFilter } from "./admin-ui-filters";
import { shortAdminPasoFilterNombre } from "./admin-visible-stages";

/** Suma `row.etapas` para las internas del paso Admin (p. ej. 9+10). */
export function adminProductionSelectedStageCount(
  row: Pick<AdminAsesorProductionRow, "etapas">,
  etapaActuales: readonly number[] | null,
): number {
  if (!etapaActuales || etapaActuales.length === 0) return 0;
  let sum = 0;
  for (const etapa of etapaActuales) {
    const n = row.etapas[String(etapa)];
    if (typeof n === "number" && Number.isFinite(n)) sum += n;
  }
  return sum;
}

/**
 * Si paso = todas → filas intactas.
 * Si hay etapa → solo asesores con count > 0, ordenados por count DESC
 * y `enviadosAMesa` como desempate.
 */
export function filterAdminProductionRowsByPaso(
  rows: readonly AdminAsesorProductionRow[],
  pasoFilter: string,
): readonly AdminAsesorProductionRow[] {
  const etapas = etapaActualesFromAdminPasoFilter(pasoFilter);
  if (!etapas) return rows;
  return [...rows]
    .map((row) => ({
      row,
      count: adminProductionSelectedStageCount(row, etapas),
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.row.enviadosAMesa - a.row.enviadosAMesa;
    })
    .map((x) => x.row);
}

/** Nombre corto del paso Admin (p. ej. «Inscripción»). */
export function shortPasoVisualAdminFilterNombre(
  pasoFilter: string,
): string | null {
  return shortAdminPasoFilterNombre(pasoFilter);
}
