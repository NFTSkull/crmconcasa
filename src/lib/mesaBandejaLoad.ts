/**
 * Orquestación de carga secundaria de la bandeja Mesa (/mesa-control).
 * Objetivo P100: evitar N+1 de resúmenes documentales y duplicar el fetch inicial.
 */

import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import type { ClienteDatosEstadoBatch } from "@/domain/expediente-cliente-datos/types";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";
import type { AgendaNotificacionActiveBooking } from "@/domain/agenda-biometricos/repo";
import type { MesaExpedienteMarcador } from "@/domain/expediente-mesa-marcadores";
import type {
  MesaBandejaActiveBookingFlags,
  MesaBandejaRetencionHint,
} from "@/lib/mesaBandejaAccionesEnrich";

export type MesaBandejaSecondaryIds = {
  allExpedienteIds: readonly string[];
  etapa3ExpedienteIds: readonly string[];
  /** Etapas que necesitan flags de booking biométricos/firmas (P119). */
  bookingHintExpedienteIds?: readonly string[];
  /** Etapa 8: retención (P119). */
  etapa8ExpedienteIds?: readonly string[];
};

export type MesaBandejaSecondaryFetchResult = {
  resumenPorId: Record<string, ExpedienteArchivoResumen[]>;
  estadosPorId: Record<string, ClienteDatosEstadoBatch>;
  notificacionPorId: Map<string, AgendaNotificacionActiveBooking>;
  opsRows: MesaExpedienteOpsRow[];
  bookingFlagsPorId: Map<string, MesaBandejaActiveBookingFlags>;
  retencionPorId: Map<string, MesaBandejaRetencionHint>;
  marcadorTieneDatosPorId: Map<string, MesaExpedienteMarcador>;
  /** Contadores de invocaciones (instrumentación de prueba; no I/O real). */
  callCounts: {
    listResumenBatch: number;
    listResumenByExpediente: number;
    listEstadoBatch: number;
    listNotificacion: number;
    listOps: number;
    listBookingFlags: number;
    listRetencion: number;
    listMarcadores: number;
  };
  elapsedMs: number;
};

export type MesaBandejaSecondaryFetchers = {
  listResumenBatchByExpedienteIds: (
    ids: readonly string[],
  ) => Promise<Record<string, ExpedienteArchivoResumen[]>>;
  listEstadoBatchByExpedienteIds: (
    ids: readonly string[],
  ) => Promise<Record<string, ClienteDatosEstadoBatch>>;
  listActiveNotificacionByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<Map<string, AgendaNotificacionActiveBooking>>;
  listMesaOpsByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<MesaExpedienteOpsRow[]>;
  listActiveBookingFlagsByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<Map<string, MesaBandejaActiveBookingFlags>>;
  listRetencionHintsByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<Map<string, MesaBandejaRetencionHint>>;
  listTieneDatosMarcadoresByExpedienteIds?: (
    ids: readonly string[],
  ) => Promise<Map<string, MesaExpedienteMarcador>>;
};

/**
 * Patrón legacy (antes de P100): 1 query de resumen por expediente.
 * Solo para medición controlada en tests; no usar en UI.
 */
export async function fetchMesaBandejaResumenLegacyN1(
  ids: readonly string[],
  listResumenByExpediente: (id: string) => Promise<ExpedienteArchivoResumen[]>,
): Promise<{
  resumenPorId: Record<string, ExpedienteArchivoResumen[]>;
  listResumenByExpedienteCalls: number;
  elapsedMs: number;
}> {
  const started = Date.now();
  let listResumenByExpedienteCalls = 0;
  const entries = await Promise.all(
    ids.map(async (id) => {
      listResumenByExpedienteCalls += 1;
      try {
        const rows = await listResumenByExpediente(id);
        return [id, rows] as const;
      } catch {
        return [id, [] as ExpedienteArchivoResumen[]] as const;
      }
    }),
  );
  return {
    resumenPorId: Object.fromEntries(entries),
    listResumenByExpedienteCalls,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Carga secundaria en paralelo: resumen batch + estados + notificaciones + ops.
 * Errores parciales se absorben (bandeja usable sin badges secundarios).
 */
export async function fetchMesaBandejaSecondaryParallel(
  ids: MesaBandejaSecondaryIds,
  fetchers: MesaBandejaSecondaryFetchers,
): Promise<MesaBandejaSecondaryFetchResult> {
  const started = Date.now();
  const callCounts = {
    listResumenBatch: 0,
    listResumenByExpediente: 0,
    listEstadoBatch: 0,
    listNotificacion: 0,
    listOps: 0,
    listBookingFlags: 0,
    listRetencion: 0,
    listMarcadores: 0,
  };

  const resumenPromise = (async () => {
    callCounts.listResumenBatch += 1;
    try {
      return await fetchers.listResumenBatchByExpedienteIds(ids.allExpedienteIds);
    } catch {
      return {} as Record<string, ExpedienteArchivoResumen[]>;
    }
  })();

  const estadosPromise = (async () => {
    callCounts.listEstadoBatch += 1;
    try {
      return await fetchers.listEstadoBatchByExpedienteIds(ids.allExpedienteIds);
    } catch {
      return {} as Record<string, ClienteDatosEstadoBatch>;
    }
  })();

  const notificacionPromise = (async () => {
    if (!fetchers.listActiveNotificacionByExpedienteIds) {
      return new Map<string, AgendaNotificacionActiveBooking>();
    }
    callCounts.listNotificacion += 1;
    try {
      return await fetchers.listActiveNotificacionByExpedienteIds(
        ids.etapa3ExpedienteIds,
      );
    } catch {
      return new Map<string, AgendaNotificacionActiveBooking>();
    }
  })();

  const opsPromise = (async () => {
    if (!fetchers.listMesaOpsByExpedienteIds) {
      return [] as MesaExpedienteOpsRow[];
    }
    callCounts.listOps += 1;
    try {
      return await fetchers.listMesaOpsByExpedienteIds(ids.allExpedienteIds);
    } catch {
      return [] as MesaExpedienteOpsRow[];
    }
  })();

  const bookingFlagsPromise = (async () => {
    if (!fetchers.listActiveBookingFlagsByExpedienteIds) {
      return new Map<string, MesaBandejaActiveBookingFlags>();
    }
    const target = ids.bookingHintExpedienteIds ?? [];
    if (target.length === 0) return new Map<string, MesaBandejaActiveBookingFlags>();
    callCounts.listBookingFlags += 1;
    try {
      return await fetchers.listActiveBookingFlagsByExpedienteIds(target);
    } catch {
      return new Map<string, MesaBandejaActiveBookingFlags>();
    }
  })();

  const retencionPromise = (async () => {
    if (!fetchers.listRetencionHintsByExpedienteIds) {
      return new Map<string, MesaBandejaRetencionHint>();
    }
    const target = ids.etapa8ExpedienteIds ?? [];
    if (target.length === 0) return new Map<string, MesaBandejaRetencionHint>();
    callCounts.listRetencion += 1;
    try {
      return await fetchers.listRetencionHintsByExpedienteIds(target);
    } catch {
      return new Map<string, MesaBandejaRetencionHint>();
    }
  })();

  const marcadoresPromise = (async () => {
    if (!fetchers.listTieneDatosMarcadoresByExpedienteIds) {
      return new Map<string, MesaExpedienteMarcador>();
    }
    callCounts.listMarcadores += 1;
    try {
      return await fetchers.listTieneDatosMarcadoresByExpedienteIds(
        ids.allExpedienteIds,
      );
    } catch {
      return new Map<string, MesaExpedienteMarcador>();
    }
  })();

  const [
    resumenPorId,
    estadosPorId,
    notificacionPorId,
    opsRows,
    bookingFlagsPorId,
    retencionPorId,
    marcadorTieneDatosPorId,
  ] = await Promise.all([
    resumenPromise,
    estadosPromise,
    notificacionPromise,
    opsPromise,
    bookingFlagsPromise,
    retencionPromise,
    marcadoresPromise,
  ]);

  return {
    resumenPorId,
    estadosPorId,
    notificacionPorId,
    opsRows,
    bookingFlagsPorId,
    retencionPorId,
    marcadorTieneDatosPorId,
    callCounts,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Una sola carga inicial: el userId de Mesa no debe re-disparar el fetch pesado.
 * Se resuelve dentro del load o se aplica después solo a badges de lectura.
 */
export function shouldRefetchMesaBandejaOnCurrentUserIdChange(): boolean {
  return false;
}

/** Consultas de listado + secundarias esperadas en un montaje (modo batch Supabase). */
export function expectedMesaBandejaInitialQueryBudget(opts: {
  expedienteCount: number;
  resumenBatchChunkSize: number;
  includeNotificaciones: boolean;
  includeOps: boolean;
  includeAsesorDisplay: boolean;
}): {
  listExpedientes: number;
  resumenBatchChunks: number;
  listEstadoBatch: number;
  listNotificacion: number;
  listOps: number;
  asesorDisplay: number;
  /** Techo sin contar get_asesor_display (0|1 según creators). */
  maxSecondaryParallel: number;
} {
  const chunks =
    opts.expedienteCount === 0
      ? 0
      : Math.ceil(opts.expedienteCount / Math.max(1, opts.resumenBatchChunkSize));
  return {
    listExpedientes: 1,
    resumenBatchChunks: chunks,
    listEstadoBatch: 1,
    listNotificacion: opts.includeNotificaciones ? 1 : 0,
    listOps: opts.includeOps ? 1 : 0,
    asesorDisplay: opts.includeAsesorDisplay ? 1 : 0,
    maxSecondaryParallel: 4,
  };
}
