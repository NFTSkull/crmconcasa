/**
 * P130.2 — solicitud de corrección Mesa (histórica) desde `documento_revisiones`.
 * Sin migración: tabla + RLS ya existen. No usa action_log ni updated_at.
 */

import { z } from "zod";
import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";
import type { MesaCorreccionSolicitudHistorica } from "@/lib/mesaAsesorCambiosUi";
import {
  aggregateCorreccionSolicitudHistorica,
  type DocumentoRevisionRechazoRow,
} from "@/lib/mesaAsesorCambiosUi";

const rowSchema = z.object({
  expediente_id: z.string().uuid(),
  documento_id: z.string().uuid(),
  comentario_mesa: z.string().nullable().optional(),
  actor_id: z.string().uuid().nullable().optional(),
  created_at: z.string(),
});

/**
 * Batch de rechazos documentales canónicos para IDs de la página.
 * Una sola query `.in(expediente_id)` — sin N+1.
 */
export async function listDocumentoRevisionesRechazoByExpedienteIds(
  expedienteIds: readonly string[],
): Promise<readonly DocumentoRevisionRechazoRow[]> {
  const ids = [
    ...new Set(
      expedienteIds
        .map((x) => String(x ?? "").trim())
        .filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    ),
  ];
  if (ids.length === 0) return [];
  if (!isSupabaseConfigured() || !supabaseBrowser) return [];
  try {
    const { data, error } = await supabaseBrowser
      .from("documento_revisiones")
      .select(
        "expediente_id, documento_id, comentario_mesa, actor_id, created_at",
      )
      .in("expediente_id", ids)
      .eq("estatus_nuevo", "rechazado")
      .order("created_at", { ascending: false });
    if (error || !data) return [];
    const out: DocumentoRevisionRechazoRow[] = [];
    for (const raw of data) {
      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) continue;
      out.push({
        expedienteId: parsed.data.expediente_id,
        documentoId: parsed.data.documento_id,
        comentarioMesa: parsed.data.comentario_mesa ?? null,
        actorId: parsed.data.actor_id ?? null,
        createdAt: parsed.data.created_at,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export type ListCorreccionSolicitudHistoricaDeps = {
  listRevisionesRechazo?: (
    ids: readonly string[],
  ) => Promise<readonly DocumentoRevisionRechazoRow[]>;
  resolveActorDisplayBatch?: (
    actorIds: string[],
  ) => Promise<Map<string, string>>;
};

/**
 * Resume solicitud Mesa por expediente (solo IDs históricos).
 * `resubmittedAtByExpediente` acota el ciclo (rechazos antes del reenvío).
 */
export async function listCorreccionSolicitudHistoricaByExpedienteIds(
  expedienteIds: readonly string[],
  resubmittedAtByExpediente: ReadonlyMap<string, string | null | undefined>,
  deps?: ListCorreccionSolicitudHistoricaDeps,
): Promise<ReadonlyMap<string, MesaCorreccionSolicitudHistorica>> {
  const ids = [
    ...new Set(
      expedienteIds
        .map((x) => String(x ?? "").trim())
        .filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
    ),
  ];
  const empty = new Map<string, MesaCorreccionSolicitudHistorica>();
  if (ids.length === 0) return empty;

  const listRevisiones =
    deps?.listRevisionesRechazo ?? listDocumentoRevisionesRechazoByExpedienteIds;
  const rows = await listRevisiones(ids);
  if (rows.length === 0) {
    for (const id of ids) {
      empty.set(
        id,
        aggregateCorreccionSolicitudHistorica([], {
          resubmittedAt: resubmittedAtByExpediente.get(id) ?? null,
        }),
      );
    }
    return empty;
  }

  const byExp = new Map<string, DocumentoRevisionRechazoRow[]>();
  for (const id of ids) byExp.set(id, []);
  for (const row of rows) {
    const list = byExp.get(row.expedienteId);
    if (list) list.push(row);
  }

  const actorIds = [
    ...new Set(
      rows
        .map((r) => r.actorId?.trim())
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const actorLabels =
    deps?.resolveActorDisplayBatch && actorIds.length > 0
      ? await deps.resolveActorDisplayBatch(actorIds)
      : new Map<string, string>();

  const out = new Map<string, MesaCorreccionSolicitudHistorica>();
  for (const id of ids) {
    const aggregated = aggregateCorreccionSolicitudHistorica(byExp.get(id) ?? [], {
      resubmittedAt: resubmittedAtByExpediente.get(id) ?? null,
      actorNameById: actorLabels,
    });
    out.set(id, aggregated);
  }
  return out;
}
