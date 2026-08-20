/**
 * P203: counts Mesa async — no bloquean first paint de tarjetas.
 * Race-safe: counts de un filtro viejo no sobrescriben chips del filtro nuevo.
 */

export type MesaBandejaCountsAttempt = Readonly<{
  gen: number;
  queryKey: string;
}>;

export function beginMesaBandejaCountsFetch(
  genRef: { current: number },
  queryKey: string,
): MesaBandejaCountsAttempt {
  genRef.current += 1;
  return { gen: genRef.current, queryKey };
}

/** ¿Puede aplicarse el resultado de counts al estado de chips? */
export function shouldApplyMesaBandejaCounts(opts: {
  attempt: MesaBandejaCountsAttempt;
  activeCountsGen: number;
  activeListQueryKey: string;
}): boolean {
  return (
    opts.attempt.gen === opts.activeCountsGen &&
    opts.attempt.queryKey === opts.activeListQueryKey
  );
}

/**
 * Al cambiar de query: conservar counts solo si pertenecen a la misma identidad.
 * Si no, null (skeleton / «…») — nunca inventar 0.
 */
export function mesaBandejaCountsForDisplay(opts: {
  serverCounts: unknown | null;
  countsQueryKey: string | null;
  activeListQueryKey: string;
}): unknown | null {
  if (opts.serverCounts == null) return null;
  if (opts.countsQueryKey !== opts.activeListQueryKey) return null;
  return opts.serverCounts;
}
