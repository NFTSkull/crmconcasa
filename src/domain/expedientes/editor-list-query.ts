import type {
  EditorReprecalIntentoRow,
  EditorReprecalMeta,
} from "./editor-reprecal-read-model";
import type { ExpedienteMock } from "./mock.repo";

export const EDITOR_LIST_PAGE_SIZE = 50;

export type EditorListQuery = {
  page: number;
  pageSize?: number;
  search?: string;
};

export type EditorListPage = {
  items: ExpedienteMock[];
  total: number;
  page: number;
  pageSize: number;
  /** P185: última re-precal REAL resuelta (sidecar; no ensucia ExpedienteMock). */
  reprecalByExpedienteId?: Readonly<Record<string, EditorReprecalMeta>>;
  /** P186: intento pending apuntado (draft restore). */
  pendingIntentoByExpedienteId?: Readonly<
    Record<string, EditorReprecalIntentoRow>
  >;
};

export function normalizeEditorListPage(
  page: number,
  pageSize = EDITOR_LIST_PAGE_SIZE,
): { page: number; pageSize: number; from: number; to: number } {
  const safePageSize = Math.max(1, pageSize);
  const safePage = Math.max(1, Math.floor(page) || 1);
  const from = (safePage - 1) * safePageSize;
  return { page: safePage, pageSize: safePageSize, from, to: from + safePageSize - 1 };
}

/** Mock/local: actividad Editor = created_at (no updated_at). */
export function editorListSortKey(e: ExpedienteMock): number {
  return Date.parse(e.base.createdAt) || 0;
}

export function sortEditorListItems(items: ExpedienteMock[]): ExpedienteMock[] {
  return [...items].sort((a, b) => {
    const bu = editorListSortKey(b);
    const au = editorListSortKey(a);
    if (bu !== au) return bu - au;
    return String(b.id).localeCompare(String(a.id));
  });
}

export function matchesEditorListSearch(e: ExpedienteMock, rawSearch: string): boolean {
  const q = rawSearch.trim().toLowerCase();
  if (!q) return true;
  return (
    e.base.cliente_nombre.toLowerCase().includes(q) ||
    e.base.telefono_cliente.includes(q) ||
    e.base.programa.toLowerCase().includes(q) ||
    (e.base.nss ?? "").includes(q) ||
    (e.base.asesorId ?? "").toLowerCase().includes(q) ||
    (e.base.asesorEmail ?? "").toLowerCase().includes(q) ||
    (e.base.asesorNombre ?? "").toLowerCase().includes(q)
  );
}

/** Filtro PostgREST `.or()` para búsqueda editor (expedientes + asesor embebido). */
export function buildEditorListOrFilter(search: string): string | null {
  const term = search
    .trim()
    .replace(/,/g, " ")
    .replace(/[%_]/g, "")
    .replace(/\s+/g, " ");
  if (!term) return null;
  const pattern = `%${term}%`;
  return [
    `cliente_nombre.ilike.${pattern}`,
    `telefono_cliente.ilike.${pattern}`,
    `nss.ilike.${pattern}`,
    `programa.ilike.${pattern}`,
    `asesor.email.ilike.${pattern}`,
    `asesor.full_name.ilike.${pattern}`,
  ].join(",");
}
