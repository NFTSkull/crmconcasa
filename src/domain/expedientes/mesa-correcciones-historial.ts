"use client";

import { isSupabaseConfigured, supabaseBrowser } from "@/lib/supabaseBrowser";

export type MesaCorreccionHistorialKind =
  | "mesa_envio"
  | "correccion_solicitada"
  | "correccion_recibida"
  | "correccion_revisada";

export type MesaCorreccionHistorialCambio = Readonly<{
  id: string;
  label: string;
  tipo: string;
  documentKind: string | null;
  createdAt: string | null;
}>;

export type MesaCorreccionHistorialEvent = Readonly<{
  id: string;
  kind: MesaCorreccionHistorialKind;
  occurredAt: string;
  actorName: string | null;
  title: string;
  targetKey: string | null;
  reason: string | null;
  loteId: string | null;
  requestAt: string | null;
  changes: readonly MesaCorreccionHistorialCambio[];
}>;

type RpcCambio = {
  id?: unknown;
  label?: unknown;
  tipo?: unknown;
  document_kind?: unknown;
  created_at?: unknown;
};

type RpcEvent = {
  id?: unknown;
  kind?: unknown;
  occurred_at?: unknown;
  actor_name?: unknown;
  title?: unknown;
  target_key?: unknown;
  reason?: unknown;
  lote_id?: unknown;
  request_at?: unknown;
  changes?: unknown;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStr(value: unknown): string | null {
  const valueStr = str(value).trim();
  return valueStr ? valueStr : null;
}

function isKind(value: string): value is MesaCorreccionHistorialKind {
  return (
    value === "mesa_envio" ||
    value === "correccion_solicitada" ||
    value === "correccion_recibida" ||
    value === "correccion_revisada"
  );
}

function mapCambio(row: RpcCambio): MesaCorreccionHistorialCambio | null {
  const id = str(row.id).trim();
  const label = str(row.label).trim();
  if (!id || !label) return null;
  return {
    id,
    label,
    tipo: str(row.tipo).trim(),
    documentKind: nullableStr(row.document_kind),
    createdAt: nullableStr(row.created_at),
  };
}

function mapEvent(row: RpcEvent): MesaCorreccionHistorialEvent | null {
  const id = str(row.id).trim();
  const kindRaw = str(row.kind).trim();
  const occurredAt = str(row.occurred_at).trim();
  if (!id || !isKind(kindRaw) || !occurredAt) return null;

  const changes = Array.isArray(row.changes)
    ? row.changes
        .map((c) => mapCambio((c ?? {}) as RpcCambio))
        .filter((c): c is MesaCorreccionHistorialCambio => c != null)
    : [];

  return {
    id,
    kind: kindRaw,
    occurredAt,
    actorName: nullableStr(row.actor_name),
    title: str(row.title).trim() || "Evento de corrección",
    targetKey: nullableStr(row.target_key),
    reason: nullableStr(row.reason),
    loteId: nullableStr(row.lote_id),
    requestAt: nullableStr(row.request_at),
    changes,
  };
}

export async function fetchMesaCorreccionesHistorial(
  expedienteId: string,
): Promise<readonly MesaCorreccionHistorialEvent[]> {
  const id = expedienteId.trim();
  if (!id || !isSupabaseConfigured() || !supabaseBrowser) return [];

  const { data, error } = await supabaseBrowser.rpc(
    "mesa_get_correcciones_historial",
    { p_expediente_id: id },
  );
  if (error) throw new Error(error.message);

  const payload = data as { events?: unknown } | null;
  if (!Array.isArray(payload?.events)) return [];
  return payload.events
    .map((row) => mapEvent((row ?? {}) as RpcEvent))
    .filter((row): row is MesaCorreccionHistorialEvent => row != null);
}
