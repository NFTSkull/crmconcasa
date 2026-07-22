/**
 * P101 — Ventana de scroll infinito para la bandeja Mesa (`/mesa-control`).
 *
 * Orden canónico (no invertir):
 *   colección completa → filtros → orden → slice visible
 *
 * No pagina en servidor ni vuelve a fetch; solo reduce nodos DOM.
 */

export const MESA_BANDEJA_INITIAL_VISIBLE = 25;
export const MESA_BANDEJA_LOAD_MORE_STEP = 25;

export type MesaBandejaVisibleWindow = Readonly<{
  visibleCount: number;
  totalFiltered: number;
  visibleLength: number;
  hasMore: boolean;
  showingLabel: string | null;
}>;

/** Incrementa el límite visible en bloques de `step`, sin superar `total`. */
export function nextMesaBandejaVisibleCount(
  currentVisible: number,
  totalFiltered: number,
  step: number = MESA_BANDEJA_LOAD_MORE_STEP,
): number {
  const total = Math.max(0, Math.floor(totalFiltered));
  const cur = Math.max(0, Math.floor(currentVisible));
  const size = Math.max(1, Math.floor(step) || MESA_BANDEJA_LOAD_MORE_STEP);
  if (total === 0) return 0;
  return Math.min(total, cur + size);
}

/** Al cambiar filtros: volver al tamaño inicial (no al total). */
export function resetMesaBandejaVisibleCount(
  initial: number = MESA_BANDEJA_INITIAL_VISIBLE,
): number {
  return Math.max(1, Math.floor(initial) || MESA_BANDEJA_INITIAL_VISIBLE);
}

/**
 * Recorta la lista ya filtrada/ordenada.
 * Nunca filtra aquí: el caller pasa el resultado completo.
 */
export function sliceMesaBandejaVisible<T>(
  filteredSorted: readonly T[],
  visibleCount: number,
): T[] {
  const n = Math.max(0, Math.floor(visibleCount));
  if (n <= 0) return [];
  return filteredSorted.slice(0, n);
}

export function mesaBandejaHasMore(
  visibleCount: number,
  totalFiltered: number,
): boolean {
  return totalFiltered > 0 && visibleCount < totalFiltered;
}

/** Botón «Cargar más» solo si hay más y el observer no está disponible. */
export function shouldShowMesaBandejaLoadMoreFallback(opts: {
  hasMore: boolean;
  intersectionObserverAvailable: boolean;
}): boolean {
  return opts.hasMore && !opts.intersectionObserverAvailable;
}

export function describeMesaBandejaVisibleWindow(
  visibleCount: number,
  totalFiltered: number,
): MesaBandejaVisibleWindow {
  const total = Math.max(0, totalFiltered);
  const visibleLength = Math.min(Math.max(0, visibleCount), total);
  const hasMore = mesaBandejaHasMore(visibleLength, total);
  return {
    visibleCount: visibleLength,
    totalFiltered: total,
    visibleLength,
    hasMore,
    showingLabel:
      total === 0
        ? null
        : `Mostrando ${visibleLength} de ${total}`,
  };
}

/**
 * Clave de criterios que reinician la ventana a 25.
 * (Coincide con la lista del ticket P101 + subfiltro P094 / origen admin.)
 */
export function mesaBandejaInfiniteResetKey(parts: {
  quickFilter: string;
  mesaOpsFilter: string;
  buscar: string;
  etapaFilter: string;
  subestadoFilter: string;
  soloCitasHoy: boolean;
  rechazosCancelacionesSubfiltro?: string;
  adminOrigenTab?: string;
}): string {
  return [
    parts.quickFilter,
    parts.mesaOpsFilter,
    parts.buscar.trim(),
    parts.etapaFilter,
    parts.subestadoFilter,
    parts.soloCitasHoy ? "1" : "0",
    parts.rechazosCancelacionesSubfiltro ?? "",
    parts.adminOrigenTab ?? "",
  ].join("|");
}

export function isIntersectionObserverAvailable(
  globalObj: { IntersectionObserver?: unknown } = globalThis,
): boolean {
  return typeof globalObj.IntersectionObserver === "function";
}
