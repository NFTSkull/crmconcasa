/**
 * P205-B1 — getMesaBandejaCounts (RPC counts-only + fallback PGRST202).
 * Sin semántica de negocio: solo cableado y race-safe mapping.
 */

import { z } from "zod";
import type { MesaBandejaServerCounts } from "@/domain/expedientes/list-for-mesa-control-paginated";
import { mapRpcCountsToServerCounts } from "@/domain/expedientes/list-for-mesa-control-paginated";

export type GetMesaBandejaCountsInput = Readonly<{
  todayYmd: string | null;
  origen: string | null;
}>;

const countsObjectSchema = z
  .object({
    correccionesEnviadas: z.number().int().nonnegative(),
    correccionesSolicitadas: z.number().int().nonnegative(),
    otrasActualizaciones: z.number().int().nonnegative(),
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
  .partial();

export function isMesaBandejaCountsRpcMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  const code = String(e.code ?? "");
  const msg = String(e.message ?? "");
  if (code === "PGRST202") return true;
  return /mesa_bandeja_counts_fast/i.test(msg) && /could not find|not find|PGRST202/i.test(msg);
}

export function parseMesaBandejaCountsRpcPayload(
  data: unknown,
): MesaBandejaServerCounts | null {
  const parsed = countsObjectSchema.safeParse(data);
  if (!parsed.success) return null;
  return mapRpcCountsToServerCounts(parsed.data);
}

/** Contrato: counts FE no debe pasar por list RPC cuando fast existe. */
export function mesaBandejaCountsShouldUseListRpcFallback(opts: {
  fastRpcMissing: boolean;
}): boolean {
  return opts.fastRpcMissing === true;
}
