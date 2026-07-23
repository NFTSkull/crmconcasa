import { z } from "zod";
import type { ExpedienteMock } from "./mock.repo";
import type { MesaOpsFilter } from "@/lib/mesaOpsUi";
import type { MesaQuickFilter, MesaRechazosCancelacionesSubfiltro } from "@/lib/mesaBandejaFiltros";
import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos/types";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";

/** Tamaño de página canónico P102 (bandeja Mesa). */
export const MESA_BANDEJA_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Cursor keyset estable: (sort_ts ASC, id ASC). */
export type MesaBandejaCursor = Readonly<{
  sortTs: string;
  id: string;
}>;

export type MesaBandejaServerCounts = Readonly<{
  correccionesEnviadas: number;
  nuevos: number;
  enProceso: number;
  citasHoy: number;
  rechazosCancelaciones: number;
  rechazados: number;
  cancelados: number;
  bloqueadosRechazados: number;
  enValidacionMesa: number;
  enEsperaAsesor: number;
  totalBandeja: number;
}>;

export type MesaBandejaPageItem = ExpedienteMock &
  Readonly<{
    sortTs: string;
    categoriaResumen?: CategoriaResumenDocumental | null;
    opsHint?: Pick<
      MesaExpedienteOpsRow,
      "estadoMesa" | "assignedTo" | "assignedAt" | "lastActivityAt"
    > | null;
    /** P127: actividad Mesa (JOIN batch en RPC). */
    lastViewedByName?: string | null;
    lastViewedAt?: string | null;
    lastUpdatedByName?: string | null;
    lastUpdatedAt?: string | null;
  }>;

export type ListForMesaControlPaginatedQuery = Readonly<{
  limit?: number;
  cursor?: MesaBandejaCursor | null;
  quickFilter: MesaQuickFilter;
  opsFilter: MesaOpsFilter;
  buscar?: string;
  etapa?: number | null;
  subestado?: string | null;
  soloCitasHoy?: boolean;
  todayYmd?: string | null;
  rechazosSub?: MesaRechazosCancelacionesSubfiltro;
  /** `todos` | `interno` | `externo` | null */
  origen?: string | null;
  includeCounts?: boolean;
}>;

export type PaginatedMesaBandejaResult = Readonly<{
  items: MesaBandejaPageItem[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: MesaBandejaCursor | null;
  counts: MesaBandejaServerCounts | null;
}>;

const cursorSchema = z.object({
  sort_ts: z.union([z.string(), z.null()]),
  id: z.string().uuid(),
});

const countsSchema = z
  .object({
    correccionesEnviadas: z.number().int().nonnegative(),
    nuevos: z.number().int().nonnegative(),
    enProceso: z.number().int().nonnegative(),
    citasHoy: z.number().int().nonnegative(),
    rechazosCancelaciones: z.number().int().nonnegative(),
    rechazados: z.number().int().nonnegative(),
    cancelados: z.number().int().nonnegative(),
    bloqueadosRechazados: z.number().int().nonnegative(),
    enValidacionMesa: z.number().int().nonnegative(),
    enEsperaAsesor: z.number().int().nonnegative(),
    totalBandeja: z.number().int().nonnegative(),
  })
  .partial()
  .nullable();

const rpcItemSchema = z.object({
  id: z.string().uuid(),
  programa: z.string().nullable().optional(),
  nss: z.string().nullable().optional(),
  cliente_nombre: z.string().nullable().optional(),
  telefono_cliente: z.string().nullable().optional(),
  direccion_opcional: z.string().nullable().optional(),
  asesor_id: z.string().nullable().optional(),
  origen_mesa: z.string().nullable().optional(),
  submitted_to_mesa: z.boolean().nullable().optional(),
  fecha_envio_mesa: z.string().nullable().optional(),
  etapa_actual: z.number().nullable().optional(),
  subestado: z.string().nullable().optional(),
  ciclo_estado: z.string().nullable().optional(),
  motivo_rechazo: z.string().nullable().optional(),
  comentario_rechazo: z.string().nullable().optional(),
  fecha_cita: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  expediente_anterior_id: z.string().nullable().optional(),
  reingreso_rechazo_id: z.string().nullable().optional(),
  sort_ts: z.string().nullable().optional(),
  categoria_resumen: z.string().nullable().optional(),
  ops_assigned_to: z.string().nullable().optional(),
  ops_assigned_at: z.string().nullable().optional(),
  ops_estado_mesa: z.string().nullable().optional(),
  ops_last_activity_at: z.string().nullable().optional(),
  last_viewed_by_name: z.string().nullable().optional(),
  last_viewed_at: z.string().nullable().optional(),
  last_updated_by_name: z.string().nullable().optional(),
  last_updated_at: z.string().nullable().optional(),
});

export const mesaListBandejaPageRpcSchema = z.object({
  items: z.array(rpcItemSchema),
  total_count: z.number().int().nonnegative(),
  has_more: z.boolean(),
  next_cursor: cursorSchema.nullable().optional(),
  counts: countsSchema.optional(),
});

export type MesaListBandejaPageRpc = z.infer<typeof mesaListBandejaPageRpcSchema>;

export function normalizeMesaBandejaPageLimit(limit?: number): number {
  const n = Math.floor(limit ?? MESA_BANDEJA_PAGE_SIZE);
  if (!Number.isFinite(n) || n < 1) return MESA_BANDEJA_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, n);
}

const CATEGORIAS: ReadonlySet<string> = new Set([
  "faltantes",
  "pendiente_revision_documental",
  "correccion_requerida",
  "correccion_enviada",
  "documentos_validados",
]);

export function normalizeCategoriaResumen(
  value: string | null | undefined,
): CategoriaResumenDocumental | null {
  if (!value) return null;
  return CATEGORIAS.has(value) ? (value as CategoriaResumenDocumental) : null;
}

export function mapAdminOrigenTabToRpc(
  tab: "todos" | "internos" | "externos" | string | null | undefined,
): string | null {
  if (tab === "internos") return "interno";
  if (tab === "externos") return "externo";
  if (tab === "todos" || !tab) return "todos";
  if (tab === "interno" || tab === "externo") return tab;
  return "todos";
}

export function mapRpcCountsToServerCounts(
  raw: MesaListBandejaPageRpc["counts"],
): MesaBandejaServerCounts | null {
  if (!raw) return null;
  return {
    correccionesEnviadas: raw.correccionesEnviadas ?? 0,
    nuevos: raw.nuevos ?? 0,
    enProceso: raw.enProceso ?? 0,
    citasHoy: raw.citasHoy ?? 0,
    rechazosCancelaciones: raw.rechazosCancelaciones ?? 0,
    rechazados: raw.rechazados ?? 0,
    cancelados: raw.cancelados ?? 0,
    bloqueadosRechazados: raw.bloqueadosRechazados ?? 0,
    enValidacionMesa: raw.enValidacionMesa ?? 0,
    enEsperaAsesor: raw.enEsperaAsesor ?? 0,
    totalBandeja: raw.totalBandeja ?? 0,
  };
}

export function mapNextCursorFromRpc(
  raw: MesaListBandejaPageRpc["next_cursor"],
  hasMore: boolean,
): MesaBandejaCursor | null {
  if (!hasMore || !raw?.id || !raw.sort_ts) return null;
  return { sortTs: String(raw.sort_ts), id: raw.id };
}

/**
 * Append de página sin duplicados (por id). Conserva orden de llegada (ya ordenado server).
 */
export function appendMesaBandejaItemsUnique<T extends { id: string }>(
  previous: readonly T[],
  nextPage: readonly T[],
): T[] {
  const seen = new Set(previous.map((x) => x.id));
  const out = [...previous];
  for (const item of nextPage) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** Keyset in-memory: mismo orden (sortTs ASC, id ASC). */
export function paginateMesaBandejaKeyset<T extends { id: string; sortTs: string }>(
  sorted: readonly T[],
  opts: { limit: number; cursor?: MesaBandejaCursor | null },
): { items: T[]; hasMore: boolean; nextCursor: MesaBandejaCursor | null } {
  const limit = normalizeMesaBandejaPageLimit(opts.limit);
  let start = 0;
  if (opts.cursor?.id && opts.cursor.sortTs) {
    start = sorted.findIndex((row) => {
      if (row.sortTs > opts.cursor!.sortTs) return true;
      if (row.sortTs === opts.cursor!.sortTs && row.id > opts.cursor!.id) return true;
      return false;
    });
    if (start < 0) start = sorted.length;
  }
  const slice = sorted.slice(start, start + limit + 1);
  const hasMore = slice.length > limit;
  const items = hasMore ? slice.slice(0, limit) : slice;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last
        ? { sortTs: last.sortTs, id: last.id }
        : null,
  };
}
