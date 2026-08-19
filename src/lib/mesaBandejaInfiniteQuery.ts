/**
 * Aislamiento de queries del infinite scroll Mesa (P102).
 * Generación + identidad de criterios: un request viejo puede terminar,
 * pero no puede mutar casos/total/hasMore/cursor.
 */

import { appendMesaBandejaItemsUnique } from "@/domain/expedientes";
import { mesaBandejaInfiniteResetKey } from "@/lib/mesaBandejaInfiniteScroll";

export type MesaBandejaCursorLike = Readonly<{
  sortTs: string;
  id: string;
}>;

export type MesaBandejaQueryAttempt = Readonly<{
  gen: number;
  queryKey: string;
  append: boolean;
}>;

export type MesaBandejaQueryIdentityParts = Parameters<
  typeof mesaBandejaInfiniteResetKey
>[0];

/** Identidad estable = mismos criterios que reinician la ventana. */
export function mesaBandejaQueryIdentity(
  parts: MesaBandejaQueryIdentityParts,
): string {
  return mesaBandejaInfiniteResetKey(parts);
}

export function mesaBandejaAttemptIsCurrent(
  attempt: MesaBandejaQueryAttempt,
  active: { gen: number; queryKey: string },
): boolean {
  return attempt.gen === active.gen && attempt.queryKey === active.queryKey;
}

export function canAppendMesaBandejaPage(opts: {
  requestQueryKey: string;
  activeQueryKey: string;
  serverHasMore: boolean;
  serverTotalCount: number;
  loadedCount: number;
  cursor: MesaBandejaCursorLike | null;
  cursorQueryKey: string | null;
}): boolean {
  if (opts.requestQueryKey !== opts.activeQueryKey) return false;
  if (opts.cursorQueryKey !== opts.requestQueryKey) return false;
  if (opts.serverHasMore !== true) return false;
  if (opts.serverTotalCount <= 0) return false;
  if (opts.loadedCount >= opts.serverTotalCount) return false;
  const cursor = opts.cursor;
  if (!cursor?.id || !cursor.sortTs) return false;
  return true;
}

/** Defensa final: nunca más filas que el total autoritativo del query actual. */
export function clampMesaBandejaAppendToTotal<T>(
  items: readonly T[],
  totalCount: number,
): T[] {
  const cap = Math.max(0, Math.floor(totalCount));
  if (items.length <= cap) return [...items];
  return items.slice(0, cap);
}

export function mergeMesaBandejaAppendClamped<T extends { id: string }>(
  previous: readonly T[],
  nextPage: readonly T[],
  totalCount: number,
): T[] {
  return clampMesaBandejaAppendToTotal(
    appendMesaBandejaItemsUnique(previous, nextPage),
    totalCount,
  );
}

export function beginMesaBandejaFirstPage(
  genRef: { current: number },
  activeQueryKeyRef: { current: string },
  cursorRef: { current: MesaBandejaCursorLike | null },
  cursorQueryKeyRef: { current: string | null },
  queryKey: string,
): MesaBandejaQueryAttempt {
  genRef.current += 1;
  activeQueryKeyRef.current = queryKey;
  cursorRef.current = null;
  cursorQueryKeyRef.current = null;
  return { gen: genRef.current, queryKey, append: false };
}

export function beginMesaBandejaAppend(
  genRef: { current: number },
  activeQueryKeyRef: { current: string },
  queryKey: string,
): MesaBandejaQueryAttempt {
  return { gen: genRef.current, queryKey, append: true };
}

/** Al cambiar filtros: invalidar in-flight y no dejar cursor/hasMore del query anterior. */
export function invalidateMesaBandejaPagination(opts: {
  genRef: { current: number };
  activeQueryKeyRef: { current: string };
  cursorRef: { current: MesaBandejaCursorLike | null };
  cursorQueryKeyRef: { current: string | null };
  nextQueryKey: string;
}): void {
  opts.genRef.current += 1;
  opts.activeQueryKeyRef.current = opts.nextQueryKey;
  opts.cursorRef.current = null;
  opts.cursorQueryKeyRef.current = null;
}
