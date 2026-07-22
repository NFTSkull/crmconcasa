import type { ExpedienteArchivoResumen } from "./types";

/** Tamaño de chunk para `.in(expediente_id, …)` evitando URLs/payloads enormes. */
export const LIST_RESUMEN_BATCH_CHUNK_SIZE = 40;

export function normalizeExpedienteIdsForBatch(
  expedienteIds: readonly string[],
): string[] {
  return [...new Set(expedienteIds.map((id) => String(id).trim()).filter(Boolean))];
}

export function chunkExpedienteIds(
  ids: readonly string[],
  chunkSize: number = LIST_RESUMEN_BATCH_CHUNK_SIZE,
): string[][] {
  const size = Math.max(1, Math.floor(chunkSize) || 1);
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size) as string[]);
  }
  return out;
}

/** Agrupa filas de resumen ya construidas por expediente. */
export function groupResumenByExpedienteId(
  rows: readonly ExpedienteArchivoResumen[],
): Record<string, ExpedienteArchivoResumen[]> {
  const out: Record<string, ExpedienteArchivoResumen[]> = {};
  for (const row of rows) {
    const id = String(row.expediente_id ?? "").trim();
    if (!id) continue;
    if (!out[id]) out[id] = [];
    out[id].push(row);
  }
  return out;
}
