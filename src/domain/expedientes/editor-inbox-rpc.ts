/**
 * P186 B1A — contratos RPC Editor inbox (IDs page + draft).
 * B1A no cablea UI; el repo seguirá leyendo filas con EXPEDIENTES_LIST_SELECT.
 */
import { z } from "zod";

export const EDITOR_INBOX_DEFAULT_PAGE_SIZE = 50;
export const EDITOR_INBOX_MAX_PAGE_SIZE = 100;

export const editorListExpedienteIdsPageInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(EDITOR_INBOX_MAX_PAGE_SIZE)
    .default(EDITOR_INBOX_DEFAULT_PAGE_SIZE),
  search: z.string().nullable().optional(),
});

export type EditorListExpedienteIdsPageInput = z.infer<
  typeof editorListExpedienteIdsPageInputSchema
>;

export const editorListExpedienteIdItemSchema = z.object({
  id: z.string().uuid(),
  editor_activity_at: z.string(),
});

export const editorListExpedienteIdsPageResultSchema = z.object({
  items: z.array(editorListExpedienteIdItemSchema),
  total_count: z.number().int().nonnegative(),
  page: z.number().int().min(1).optional(),
  page_size: z.number().int().min(1).optional(),
});

export type EditorListExpedienteIdsPageResult = z.infer<
  typeof editorListExpedienteIdsPageResultSchema
>;

export function normalizeEditorInboxPageOptions(input: {
  page?: number;
  page_size?: number;
}): { page: number; page_size: number; from: number; to: number } {
  const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const raw = input.page_size ?? EDITOR_INBOX_DEFAULT_PAGE_SIZE;
  const page_size = Math.min(
    EDITOR_INBOX_MAX_PAGE_SIZE,
    Math.max(1, Math.floor(raw) || EDITOR_INBOX_DEFAULT_PAGE_SIZE),
  );
  const from = (page - 1) * page_size;
  return { page, page_size, from, to: from + page_size - 1 };
}

export const editorGuardarBorradorReprecalInputSchema = z.object({
  expediente_id: z.string().uuid(),
  monto_aprobado: z.number().nonnegative().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export const editorGuardarBorradorReprecalResultSchema = z.object({
  ok: z.literal(true),
  expediente_id: z.string().uuid(),
  intento_id: z.string().uuid(),
  decision: z.literal("pendiente"),
  monto_aprobado: z.union([z.number(), z.string(), z.null()]).optional(),
  notas_revision: z.string().optional(),
});

export type EditorGuardarBorradorReprecalResult = z.infer<
  typeof editorGuardarBorradorReprecalResultSchema
>;

export const EDITOR_LIST_PAGE_INCOMPLETE_MSG =
  "No se pudo cargar correctamente la página del Editor.";

export const EDITOR_FOCUS_REFRESH_MIN_MS = 8_000;

/** Reconstruye filas en el orden exacto del RPC. PostgREST `.in()` no lo garantiza. */
export function reorderEditorRowsByRpcIds<T extends { id: string }>(
  orderedIds: readonly string[],
  rows: readonly T[],
): T[] {
  const rowById = new Map(rows.map((row) => [String(row.id), row]));
  const out: T[] = [];
  for (const id of orderedIds) {
    const row = rowById.get(String(id));
    if (!row) {
      const err = new Error(EDITOR_LIST_PAGE_INCOMPLETE_MSG);
      err.name = "EditorListPageIncompleteError";
      throw err;
    }
    out.push(row);
  }
  return out;
}

export function shouldSkipEditorFocusRefresh(input: {
  now: number;
  lastRefreshAt: number;
  minMs?: number;
  hasLocalWork: boolean;
}): boolean {
  if (input.hasLocalWork) return true;
  const min = input.minMs ?? EDITOR_FOCUS_REFRESH_MIN_MS;
  return input.now - input.lastRefreshAt < min;
}
