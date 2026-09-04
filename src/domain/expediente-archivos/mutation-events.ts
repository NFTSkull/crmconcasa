"use client";

import type { ExpedienteArchivosRepo } from "./repo";

export const EXPEDIENTE_ARCHIVOS_UPDATED_EVENT = "expediente_archivos_updated";
export const EXPEDIENTE_CORRECCION_REFRESH_EVENT = "mesa_control_inbox_updated";

function notifyMutation(expedienteId?: string | null): void {
  if (typeof window === "undefined") return;
  const detail = { expedienteId: expedienteId?.trim() || null };
  window.dispatchEvent(
    new CustomEvent(EXPEDIENTE_ARCHIVOS_UPDATED_EVENT, { detail }),
  );
  window.dispatchEvent(
    new CustomEvent(EXPEDIENTE_CORRECCION_REFRESH_EVENT, { detail }),
  );
}

/**
 * Decorador del repo Supabase: después de una mutación documental exitosa,
 * notifica a las pantallas abiertas para que refresquen documentos + estado causal.
 * Nunca emite en error y no altera el resultado de la operación original.
 */
export function withExpedienteArchivoMutationEvents(
  repo: ExpedienteArchivosRepo,
): ExpedienteArchivosRepo {
  return {
    listByExpediente: (expedienteId) => repo.listByExpediente(expedienteId),
    listResumenByExpediente: (expedienteId) =>
      repo.listResumenByExpediente(expedienteId),
    listResumenBatchByExpedienteIds: (expedienteIds) =>
      repo.listResumenBatchByExpedienteIds(expedienteIds),
    getArchivoBlob: (id) => repo.getArchivoBlob(id),

    uploadArchivo: async (params) => {
      await repo.uploadArchivo(params);
      notifyMutation(params.expedienteId);
    },
    replaceArchivo: async (params) => {
      await repo.replaceArchivo(params);
      notifyMutation(params.expedienteId);
    },
    uploadMesaDocumento: async (params) => {
      await repo.uploadMesaDocumento(params);
      notifyMutation(params.expedienteId);
    },
    replaceMesaDocumento: async (params) => {
      await repo.replaceMesaDocumento(params);
      notifyMutation(params.expedienteId);
    },
    deleteMesaDocumento: async (params) => {
      await repo.deleteMesaDocumento(params);
      notifyMutation(params.expedienteId);
    },
    correctArchivoRechazado: async (params) => {
      await repo.correctArchivoRechazado(params);
      notifyMutation(params.expedienteId);
    },
    updateRevision: async (id, patch) => {
      await repo.updateRevision(id, patch);
    },
    deleteArchivo: repo.deleteArchivo
      ? async (id) => {
          await repo.deleteArchivo?.(id);
          notifyMutation(null);
        }
      : undefined,
  };
}
