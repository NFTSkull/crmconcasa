import type { ExpedienteMock } from "./mock.repo";

export type ListForAsesorPaginatedOptions = {
  page: number;
  pageSize: number;
};

export type PaginatedExpedientesResult = {
  items: ExpedienteMock[];
  totalCount: number;
};

const MAX_PAGE_SIZE = 100;

/** Normaliza página y tamaño para listados paginados del asesor. */
export function normalizeAsesorPaginationOptions(
  options: ListForAsesorPaginatedOptions,
): { page: number; pageSize: number; from: number; to: number } {
  const page = Math.max(1, Math.floor(options.page) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(options.pageSize) || 1),
  );
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

export function sortExpedientesByCreatedAtDesc(
  items: ExpedienteMock[],
): ExpedienteMock[] {
  return items.slice().sort(
    (a, b) =>
      new Date(b.base.createdAt).getTime() - new Date(a.base.createdAt).getTime(),
  );
}

/** Corta un arreglo ya ordenado por `createdAt` descendente. */
export function paginateSortedExpedientes(
  sorted: ExpedienteMock[],
  options: ListForAsesorPaginatedOptions,
): PaginatedExpedientesResult {
  const { pageSize, from } = normalizeAsesorPaginationOptions(options);
  return {
    items: sorted.slice(from, from + pageSize),
    totalCount: sorted.length,
  };
}
