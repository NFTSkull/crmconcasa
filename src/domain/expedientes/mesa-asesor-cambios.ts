/**
 * P130/P194 — wrappers Zod para RPCs de lote de cambios del asesor (Mesa).
 */

import { z } from "zod";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  normalizeMesaAsesorCambioHistoryConfidence,
  normalizeMesaAsesorCambioLabel,
  normalizeMesaAsesorCambioPreviewSource,
  type MesaAsesorCambio,
  type MesaAsesorCambioHistoryConfidence,
  type MesaAsesorCambioLote,
  type MesaAsesorCambioPreviewItem,
  type MesaAsesorCambioPreviewSource,
  type MesaAsesorCambiosSummaryItem,
  type MesaAsesorCambioStatus,
  type MesaAsesorCambioTipo,
} from "@/lib/mesaAsesorCambiosUi";

const statusSchema = z.enum(["borrador", "pendiente_revision", "revisado"]);

const previewItemSchema = z.object({
  tipo: z.string(),
  campo: z.string().nullable().optional(),
  document_kind: z.string().nullable().optional(),
  label: z.string().optional().default(""),
  has_old: z.boolean().optional().default(false),
  has_new: z.boolean().optional().default(false),
  source: z.string().optional().default("P130"),
});

const summaryItemSchema = z.object({
  expediente_id: z.string().uuid(),
  batch_id: z.string().uuid().nullable().optional(),
  status: statusSchema.nullable().optional(),
  submitted_at: z.string().nullable().optional(),
  changes_count: z.number().int().nonnegative().optional().default(0),
  summary: z.array(z.string()).optional().default([]),
  preview_changes: z.array(previewItemSchema).optional().default([]),
  history_confidence: z.string().nullable().optional(),
  history_source: z.string().nullable().optional(),
  history_note: z.string().nullable().optional(),
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
  source: z.string().nullable().optional(),
});

const getLoteRpcSchema = z.object({
  ok: z.boolean().optional(),
  lote: loteSchema.optional().default(null),
  changes: z.array(changeSchema).optional().default([]),
  recovered_changes: z.array(changeSchema).optional().default([]),
  history_confidence: z.string().nullable().optional(),
  history_source: z.string().nullable().optional(),
  history_note: z.string().nullable().optional(),
});

const marcarRpcSchema = z.object({
  ok: z.boolean().optional(),
  status: statusSchema.optional(),
});

function mapPreviewItem(
  row: z.infer<typeof previewItemSchema>,
): MesaAsesorCambioPreviewItem {
  return {
    tipo: row.tipo,
    campo: row.campo ?? null,
    documentKind: row.document_kind ?? null,
    label: normalizeMesaAsesorCambioLabel(row.label),
    hasOld: row.has_old ?? false,
    hasNew: row.has_new ?? false,
    source: normalizeMesaAsesorCambioPreviewSource(row.source),
  };
}

function mapSummaryItem(
  row: z.infer<typeof summaryItemSchema>,
): MesaAsesorCambiosSummaryItem {
  const previewChanges = (row.preview_changes ?? []).map(mapPreviewItem);
  const summary =
    (row.summary ?? []).length > 0
      ? (row.summary ?? []).map(normalizeMesaAsesorCambioLabel)
      : previewChanges.map((p) => p.label);
  return {
    expedienteId: row.expediente_id,
    batchId: row.batch_id ?? null,
    status: (row.status as MesaAsesorCambioStatus | null) ?? null,
    submittedAt: row.submitted_at ?? null,
    changesCount: row.changes_count ?? 0,
    summary,
    previewChanges,
    historyConfidence: normalizeMesaAsesorCambioHistoryConfidence(
      row.history_confidence,
    ),
    historySource: row.history_source
      ? normalizeMesaAsesorCambioPreviewSource(row.history_source)
      : null,
    historyNote: row.history_note?.trim() || null,
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
    label: normalizeMesaAsesorCambioLabel(row.label?.trim() || row.change_key),
    valorAnterior: row.valor_anterior ?? null,
    valorNuevo: row.valor_nuevo ?? null,
    documentoAnteriorId: row.documento_anterior_id ?? null,
    documentoNuevoId: row.documento_nuevo_id ?? null,
    createdAt: row.created_at ?? null,
    source: row.source
      ? normalizeMesaAsesorCambioPreviewSource(row.source)
      : "P130",
  };
}

export type MesaAsesorCambiosSummaryErrorReason =
  | "rpc"
  | "parse"
  | "network"
  | "not_configured";

export type MesaAsesorCambiosSummaryResult = Readonly<{
  status: "success" | "error";
  items: ReadonlyMap<string, MesaAsesorCambiosSummaryItem>;
  errorReason?: MesaAsesorCambiosSummaryErrorReason;
}>;

export function mesaAsesorCambiosSummarySuccess(
  items:
    | ReadonlyMap<string, MesaAsesorCambiosSummaryItem>
    | Iterable<readonly [string, MesaAsesorCambiosSummaryItem]>,
): MesaAsesorCambiosSummaryResult {
  return {
    status: "success",
    items: items instanceof Map ? items : new Map(items),
  };
}

export function mesaAsesorCambiosSummaryError(
  reason: MesaAsesorCambiosSummaryErrorReason,
): MesaAsesorCambiosSummaryResult {
  return { status: "error", items: new Map(), errorReason: reason };
}

export async function listAsesorCambiosSummaryByExpedienteIds(
  expedienteIds: readonly string[],
): Promise<MesaAsesorCambiosSummaryResult> {
  const ids = [
    ...new Set(
      expedienteIds
        .map((x) => String(x ?? "").trim())
        .filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    ),
  ];
  if (ids.length === 0) return mesaAsesorCambiosSummarySuccess(new Map());
  if (!isSupabaseConfigured() || !supabaseBrowser) {
    return mesaAsesorCambiosSummaryError("not_configured");
  }
  try {
    const { data, error } = await supabaseBrowser.rpc(
      "mesa_list_asesor_cambios_summary",
      { p_expediente_ids: ids },
    );
    if (error || !data) return mesaAsesorCambiosSummaryError("rpc");
    const parsed = listSummaryRpcSchema.safeParse(data);
    if (!parsed.success) return mesaAsesorCambiosSummaryError("parse");
    const map = new Map<string, MesaAsesorCambiosSummaryItem>();
    for (const item of parsed.data.items) {
      map.set(item.expediente_id, mapSummaryItem(item));
    }
    return mesaAsesorCambiosSummarySuccess(map);
  } catch {
    return mesaAsesorCambiosSummaryError("network");
  }
}

export type MesaAsesorCambioLoteDetalle = Readonly<{
  lote: MesaAsesorCambioLote | null;
  changes: readonly MesaAsesorCambio[];
  recoveredChanges: readonly MesaAsesorCambio[];
  historyConfidence: MesaAsesorCambioHistoryConfidence | null;
  historySource: MesaAsesorCambioPreviewSource | null;
  historyNote: string | null;
}>;

export async function fetchMesaAsesorCambioLote(
  expedienteId: string,
): Promise<MesaAsesorCambioLoteDetalle> {
  const id = String(expedienteId ?? "").trim();
  const empty: MesaAsesorCambioLoteDetalle = {
    lote: null,
    changes: [],
    recoveredChanges: [],
    historyConfidence: null,
    historySource: null,
    historyNote: null,
  };
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
      recoveredChanges: parsed.data.recovered_changes.map(mapChange),
      historyConfidence: normalizeMesaAsesorCambioHistoryConfidence(
        parsed.data.history_confidence,
      ),
      historySource: parsed.data.history_source
        ? normalizeMesaAsesorCambioPreviewSource(parsed.data.history_source)
        : null,
      historyNote: parsed.data.history_note?.trim() || null,
    };
  } catch {
    return empty;
  }
}

function mapLoteDetalleToSummaryItem(
  expedienteId: string,
  detalle: MesaAsesorCambioLoteDetalle,
): MesaAsesorCambiosSummaryItem | null {
  if (!detalle.lote) return null;
  const changes = [...detalle.changes, ...detalle.recoveredChanges];
  const previewChanges: MesaAsesorCambioPreviewItem[] = changes.map((c) => ({
    tipo: c.tipo,
    campo: c.campo,
    documentKind: c.documentKind,
    label: c.label,
    hasOld: c.valorAnterior != null || Boolean(c.documentoAnteriorId),
    hasNew: c.valorNuevo != null || Boolean(c.documentoNuevoId),
    source: normalizeMesaAsesorCambioPreviewSource(c.source ?? "P130"),
  }));
  const summary = previewChanges.map((p) => p.label);
  return {
    expedienteId,
    batchId: detalle.lote.id,
    status: detalle.lote.status,
    submittedAt: detalle.lote.submittedAt,
    changesCount: detalle.lote.changesCount || changes.length,
    summary,
    previewChanges,
    historyConfidence: detalle.historyConfidence,
    historySource: detalle.historySource,
    historyNote: detalle.historyNote,
  };
}

/** P207.4 — retry on-demand: summary batch + fallback puntual a get_lote. */
export async function fetchAdvisorChangesSummaryForExpediente(
  expedienteId: string,
  primaryBatchId?: string | null,
): Promise<MesaAsesorCambiosSummaryResult> {
  const summaryResult = await listAsesorCambiosSummaryByExpedienteIds([expedienteId]);
  const primary = String(primaryBatchId ?? "").trim();
  if (summaryResult.status === "success") {
    const item = summaryResult.items.get(expedienteId);
    if (item && (!primary || String(item.batchId ?? "").trim() === primary)) {
      return mesaAsesorCambiosSummarySuccess(new Map([[expedienteId, item]]));
    }
    if (item && primary && String(item.batchId ?? "").trim() !== primary) {
      return mesaAsesorCambiosSummaryError("parse");
    }
  }
  const detalle = await fetchMesaAsesorCambioLote(expedienteId);
  const mapped = mapLoteDetalleToSummaryItem(expedienteId, detalle);
  if (!mapped) {
    return summaryResult.status === "error"
      ? summaryResult
      : mesaAsesorCambiosSummaryError("rpc");
  }
  if (primary && String(mapped.batchId ?? "").trim() !== primary) {
    return mesaAsesorCambiosSummaryError("parse");
  }
  return mesaAsesorCambiosSummarySuccess(new Map([[expedienteId, mapped]]));
}

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
