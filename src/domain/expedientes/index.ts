"use client";

import { useMemo } from "react";
import { isDataModeSupabase } from "@/lib/dataMode";
import { MockExpedientesRepo } from "./mock.repo";
import { SupabaseExpedientesRepo } from "./supabase.repo";
import type { ExpedientesRepo } from "./repo";

export type { ExpedientesRepo } from "./repo";
export type {
  ListForAsesorPaginatedOptions,
  PaginatedExpedientesResult,
} from "./list-for-asesor-paginated";
export {
  normalizeAsesorPaginationOptions,
  paginateSortedExpedientes,
  sortExpedientesByCreatedAtDesc,
} from "./list-for-asesor-paginated";
export type {
  ListForMesaControlPaginatedQuery,
  MesaBandejaCursor,
  MesaBandejaPageItem,
  MesaBandejaServerCounts,
  PaginatedMesaBandejaResult,
} from "./list-for-mesa-control-paginated";
export {
  MESA_BANDEJA_PAGE_SIZE,
  appendMesaBandejaItemsUnique,
  mapAdminOrigenTabToRpc,
  normalizeMesaBandejaPageLimit,
  paginateMesaBandejaKeyset,
} from "./list-for-mesa-control-paginated";
export type { CreateExpedienteInput } from "./create-expediente.input";
export type { UpsertEditorDecisionInput } from "./upsert-editor-decision.input";
export type { EditorListPage, EditorListQuery } from "./editor-list-query";
export {
  deriveMesaMovimientoAdvertencias,
  getMesaControlManualEstado,
  getMesaMovimientoDireccion,
  getMesaMovimientoErrorCode,
  mapMesaMovimientoRpcError,
  mesaEtapaSchema,
  MESA_MOVIMIENTO_SUBESTADOS_ELEGIBLES,
  mesaMovimientoHistorialRowSchema,
  mesaMovimientoInputSchema,
  mesaMovimientoResultadoSchema,
  puedeConfirmarMovimientoMesa,
  puedeMostrarControlManualMesa,
  type MesaControlManualEstado,
  type MesaMovimientoHistorialRow,
  type MesaMovimientoInput,
  type MesaMovimientoResultado,
} from "./mesa-movimiento-etapa";
export {
  esElegibleRechazoOperativoPostBiometricos,
  mensajeAdvertenciaMotivoPareceRechazo,
  MESA_MOTIVO_PARECE_RECHAZO_SIN_ELEGIBILIDAD_WARNING,
  MESA_MOTIVO_PARECE_RECHAZO_WARNING,
  MESA_MOVIMIENTO_NO_ES_RECHAZO_COPY,
  MESA_RECHAZO_OPERATIVO_ANCHOR_ID,
  MESA_RECHAZO_OPERATIVO_ATAJO_LABEL,
  MESA_RECHAZO_OPERATIVO_CARD_BADGE,
  MESA_RECHAZO_OPERATIVO_CARD_CTA,
  MESA_RECHAZO_OPERATIVO_CARD_INTRO,
  MESA_RECHAZO_OPERATIVO_CARD_TITLE,
  motivoManualPareceRechazo,
} from "./mesa-rechazo-operativo-ux";
export {
  MESA_RECHAZO_OPERATIVO_MOTIVOS,
  isRechazoOperativoMotivoOtro,
  motivoRechazoOperativoEsValido,
  resolveMotivoRechazoOperativo,
  type MesaRechazoOperativoMotivo,
} from "./mesa-rechazo-operativo-motivos";
export { buildRechazoOperativoPayload } from "./mesa-rechazo-operativo-payload";
export {
  cancelacionOperativaInputSchema,
  cancelacionOperativaResponseSchema,
  esElegibleCancelacionOperativa,
  esExpedienteCancelado,
  getMesaCancelacionErrorCode,
  mapMesaCancelacionRpcError,
  MESA_CANCELACION_OPERATIVA_ANCHOR_ID,
  MESA_CANCELACION_OPERATIVA_CARD_BADGE,
  MESA_CANCELACION_OPERATIVA_CARD_CTA,
  MESA_CANCELACION_OPERATIVA_CARD_INTRO,
  MESA_CANCELACION_OPERATIVA_CARD_TITLE,
  type CancelacionOperativaInput,
  type CancelacionOperativaResponse,
  type ExpedienteCancelacionRow,
} from "./mesa-cancelacion-operativa";
export {
  biometricosCondicionSchema,
  esExpedienteReingreso,
  getReingresoErrorCode,
  iniciarReingresoResponseSchema,
  mapReingresoRpcError,
  puedeConsultarReingresoPostBiometricos,
  rechazoOperativoInputSchema,
  reingresoElegibilidadSchema,
  reingresoExpedienteIdSchema,
  type BiometricosCondicion,
  type IniciarReingresoResponse,
  type RechazoOperativoInput,
  type ReingresoElegibilidad,
} from "./reingreso-post-biometricos";
export {
  ASESOR_REACTIVAR_RECHAZO_CTA,
  esExpedienteRechazadoOperativoActivo,
  getReactivacionErrorCode,
  mapReactivacionRpcError,
  reactivarExpedienteResponseSchema,
  subestadoCanonicoTrasReactivacion,
  type ReactivarExpedienteResponse,
} from "./reactivar-expediente-rechazado";
export { EDITOR_LIST_PAGE_SIZE } from "./editor-list-query";
export type { ExpedienteMock, EditorDecision } from "./mock.repo";
export { MockExpedientesRepo } from "./mock.repo";
export { SupabaseExpedientesRepo, ExpedientesSupabaseError } from "./supabase.repo";
export { mapEnviarAMesaRpcError } from "./enviar-mesa-rpc-error";
export { mapAsesorUpdateMontoAprobadoRpcError } from "./asesor-update-monto-aprobado-rpc-error";
export { mapAvanzarEtapaRpcError } from "./avanzar-etapa-rpc-error";
export { mapUpsertEditorDecisionRpcError } from "./upsert-editor-decision-rpc-error";
export {
  deriveAvanceOperativo2a3View,
  deriveAvanceOperativo3a4View,
  deriveAvanceOperativo3a5View,
  deriveAvanceOperativo4a5View,
  deriveAvanceOperativo5a6View,
  deriveAvanceOperativo6a7View,
  deriveAvanceOperativo7a8View,
  deriveAvanceOperativo8a9View,
  deriveAvanceOperativo9a10View,
  deriveBloqueosContinuarIntegracion,
  deriveBloqueosAvanceOperativo8a9,
  deriveBloqueosAvanceOperativo3a5,
  deriveBloqueosAvanceOperativo4a5,
  deriveBloqueosAvanceOperativo5a6,
  deriveBloqueosAvanceOperativo9a10,
  deriveCierreValidacionDocumentalView,
  etapaTrasAvanceIntegracion1a2,
  isFechaCitaBiometricaPasada,
  puedeMostrarAvanceOperativo2a3,
  puedeMostrarAvanceOperativo3a4,
  puedeMostrarAvanceOperativo3a5,
  puedeMostrarAvanceOperativo4a5,
  puedeMostrarAvanceOperativo5a6,
  puedeMostrarAvanceOperativo6a7,
  puedeMostrarAvanceOperativo7a8,
  puedeMostrarAvanceOperativo8a9,
  puedeMostrarAvanceOperativo9a10,
  puedeContinuarIntegracion,
  puedeMostrarContinuarIntegracion,
  type AvanceOperativo2a3View,
  type AvanceOperativo3a4View,
  type AvanceOperativoEtapaView,
  type MesaAvanceOperativo4a5Context,
  type MesaAvanceOperativo5a6Context,
  type CierreValidacionDocumentalView,
  type MesaAvanceOperativoContext,
  type MesaAvanceOperativo8a9Context,
  type MesaAvanceOperativo9a10Context,
  type MesaContinuarIntegracionContext,
} from "./mesa-avance-integracion";
export {
  mapProgramaDbToUi,
  mapProgramaUiToDb,
  isProgramaMejoravit,
} from "./map-programa";
export {
  mapCreateExpedienteRpcToExpedienteMock,
  mapSupabaseRowToExpedienteMock,
} from "./map-supabase-row";

/** Factory: mock por defecto; Supabase con `NEXT_PUBLIC_DATA_MODE=supabase`. */
export function useExpedientesRepo(): ExpedientesRepo {
  return useMemo(() => {
    if (isDataModeSupabase()) {
      return new SupabaseExpedientesRepo();
    }
    return new MockExpedientesRepo();
  }, []);
}
