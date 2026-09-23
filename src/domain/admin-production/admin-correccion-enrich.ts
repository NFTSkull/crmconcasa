/**
 * Enriquece envíos Admin con asesor_correccion_detalle (fail-soft, concurrencia limitada).
 */
import type { AsesorCorreccionDetalle } from "@/domain/expedientes/asesor-correccion-detalle";
import type { AdminMesaEnvioEvent } from "./metrics";
import {
  matchesAdminCorreccionFilter,
  type AdminCorreccionFilter,
} from "./admin-correccion-filter";

export const ADMIN_CORRECCION_DETAIL_CONCURRENCY = 5;

export type AdminCorreccionEnrichedRow = Readonly<{
  mesa: AdminMesaEnvioEvent;
  /** null si no hay corrección vigente o fallo de lectura. */
  detalle: AsesorCorreccionDetalle | null;
  /** true = error técnico; no clasificar como pendiente/reenviada. */
  readError: boolean;
}>;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, n));
  const results: R[] = new Array(n);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const i = nextIndex;
        nextIndex += 1;
        if (i >= n) return;
        results[i] = await fn(items[i]!, i);
      }
    }),
  );

  return results;
}

export async function enrichAdminMesaWithCorreccionDetalle(
  mesaEnvios: readonly AdminMesaEnvioEvent[],
  getDetalle: (
    expedienteId: string,
  ) => Promise<AsesorCorreccionDetalle | null>,
  concurrency: number = ADMIN_CORRECCION_DETAIL_CONCURRENCY,
): Promise<AdminCorreccionEnrichedRow[]> {
  return mapWithConcurrency(mesaEnvios, concurrency, async (mesa) => {
    try {
      const detalle = await getDetalle(mesa.expedienteId);
      return { mesa, detalle, readError: false };
    } catch {
      return { mesa, detalle: null, readError: true };
    }
  });
}

/**
 * Filtra filas enriquecidas por ux_state canónico.
 * - readError → excluir (no inventar corrección).
 * - detalle null / sin ux vigente → excluir.
 * - filter "todas" → todas las vigentes (uso PDF / export completo).
 */
export function selectAdminCorreccionRows(
  rows: readonly AdminCorreccionEnrichedRow[],
  filter: AdminCorreccionFilter,
): AdminCorreccionEnrichedRow[] {
  return rows.filter((row) => {
    if (row.readError) return false;
    return matchesAdminCorreccionFilter(row.detalle?.ux_state, filter);
  });
}
