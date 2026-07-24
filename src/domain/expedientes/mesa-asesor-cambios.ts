/**
 * P130 — wrappers Zod para RPCs de lote de cambios del asesor (Mesa).
 * Lectura batch/detalle + marcar revisados (fail soft).
 */

import { z } from "zod";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type {
  MesaAsesorCambio,
  MesaAsesorCambioLote,
  MesaAsesorCambiosSummaryItem,
  MesaAsesorCambioStatus,
  MesaAsesorCambioTipo,
} from "@/lib/mesaAsesorCambiosUi";

const statusSchema = z.enum(["borrador", "pendiente_revision", "revisado"]);

const summaryItemSchema = z.object({
  expediente_id: z.string().uuid(),
  batch_id: z.string().uuid().nullable().optional(),
  status: statusSchema.nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  changes_count: z.number().int().nonnegative().optional().default(0),
  summary: z.array(z.string()).optional().default([]),
});

const listSummaryRpcSchema = z.object({
  ok: z.boolean().optional(),
  items: z.array(summaryItemSchema).default([]),
});

const loteSchema = z
  .object({
    id: z.string().uuid(),
    status: statusSchema,
    submitted_at: z.string().nullable().optional(),
    reviewed_at: z.string().nullable().optional(),
    asesor_nombre: z.string().nullable().optional(),
    changes_count: z.number().int().nonnegative().optional().default(0),
  })
  .nullable();

const changeSchema = z.object({
  id: z.string().uuid(),
  change_key: z.string(),
  tipo: z.string(),
  entidad: z.string().nullable().optional(),
  campo: z.string().nullable().optional(),
  document_kind: z.string().nullable().optional(),
  label: z.string().optional().default(""),
  valor_anterior: z.unknown().nullable().optional(),
  valor_nuevo: z.unknown().nullable().optional(),
  documento_anterior_id: z.string().uuid().nullable().optional(),
  documento_nuevo_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

const getLoteRpcSchema = z.object({
  ok: z.boolean().optional(),
  lote: loteSchema.optional().default(null),
  changes: z.array(changeSchema).optional().default([]),
});

const marcarRpcSchema = z.object({
  ok: z.boolean().optional(),
  status: statusSchema.optional(),
});

function mapSummaryItem(
  row: z.infer<typeof summaryItemSchema>,
): MesaAsesorCambiosSummaryItem {
  return {
    expedienteId: row.expediente_id,
    batchId: row.batch_id ?? null,
    status: (row.status as MesaAsesorCambioStatus | null) ?? null,
    submittedAt: row.submitted_at ?? null,
    changesCount: row.changes_count ?? 0,
    summary: row.summary ?? [],
  };
}

function mapLote(
  row: NonNullable<z.infer<typeof loteSchema>>,
): MesaAsesorCambioLote {
  return {
    id: row.id,
    status: row.status as MesaAsesorCambioStatus,
    submittedAt: row.submitted_at ?? null,
    reviewedAt: row.reviewed_at ?? null,
    asesorNombre: row.asesor_nombre ?? null,
    changesCount: row.changes_count ?? 0,
  };
}

function mapChange(row: z.infer<typeof changeSchema>): MesaAsesorCambio {
  return {
    id: row.id,
    changeKey: row.change_key,
    tipo: row.tipo as MesaAsesorCambioTipo,
    entidad: row.entidad ?? null,
    campo: row.campo ?? null,
    documentKind: row.document_kind ?? null,
    label: row.label?.trim() || row.change_key,
    valorAnterior: row.valor_anterior ?? null,
    valorNuevo: row.valor_nuevo ?? null,
    documentoAnteriorId: row.documento_anterior_id ?? null,
    documentoNuevoId: row.documento_nuevo_id ?? null,
    createdAt: row.created_at ?? null,
  };
}

/** Batch summaries para IDs de la página visible (sin N+1). */
export async function listAsesorCambiosSummaryByExpedienteIds(
  expedienteIds: readonly string[],
): Promise<ReadonlyMap<string, MesaAsesorCambiosSummaryItem>> {
  const ids = [
    ...new Set(
      expedienteIds
        .map((x) => String(x ?? "").trim())
        .filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    ),
  ];
  const empty = new Map<string, MesaAsesorCambiosSummaryItem>();
  if (ids.length === 0) return empty;
  if (!isSupabaseConfigured() || !supabaseBrowser) return empty;
  try {
    const { data, error } = await supabaseBrowser.rpc(
      "mesa_list_asesor_cambios_summary",
      { p_expediente_ids: ids },
    );
    if (error || !data) return empty;
    const parsed = listSummaryRpcSchema.safeParse(data);
    if (!parsed.success) return empty;
    const map = new Map<string, MesaAsesorCambiosSummaryItem>();
    for (const item of parsed.data.items) {
      map.set(item.expediente_id, mapSummaryItem(item));
    }
    return map;
  } catch {
    return empty;
  }
}

export type MesaAsesorCambioLoteDetalle = Readonly<{
  lote: MesaAsesorCambioLote | null;
  changes: readonly MesaAsesorCambio[];
}>;

/** Detalle del lote vigente (pendiente o último revisado) por expediente. */
export async function fetchMesaAsesorCambioLote(
  expedienteId: string,
): Promise<MesaAsesorCambioLoteDetalle> {
  const id = String(expedienteId ?? "").trim();
  const empty: MesaAsesorCambioLoteDetalle = { lote: null, changes: [] };
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return empty;
  if (!isSupabaseConfigured() || !supabaseBrowser) return empty;
  try {
    const { data, error } = await supabaseBrowser.rpc("mesa_get_asesor_cambio_lote", {
      p_expediente_id: id,
    });
    if (error || !data) return empty;
    const parsed = getLoteRpcSchema.safeParse(data);
    if (!parsed.success) return empty;
    return {
      lote: parsed.data.lote ? mapLote(parsed.data.lote) : null,
      changes: parsed.data.changes.map(mapChange),
    };
  } catch {
    return empty;
  }
}

/** Marca lote revisado. Fail soft (boolean). Idempotente en backend. */
export async function marcarMesaAsesorCambiosRevisados(
  loteId: string,
): Promise<boolean> {
  const id = String(loteId ?? "").trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  if (!isSupabaseConfigured() || !supabaseBrowser) return false;
  try {
    const { data, error } = await supabaseBrowser.rpc(
      "mesa_marcar_asesor_cambios_revisados",
      { p_lote_id: id },
    );
    if (error || !data) return false;
    const parsed = marcarRpcSchema.safeParse(data);
    if (!parsed.success) return false;
    return parsed.data.ok !== false;
  } catch {
    return false;
  }
}
