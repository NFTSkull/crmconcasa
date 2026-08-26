import type {
  CreateExpedienteInput,
  ExpedienteProgramaUi,
} from "./create-expediente.input";
import type {
  IniciarReprecalificacionInput,
  IniciarReprecalificacionResult,
  NssPrecalGateResult,
} from "./nss-precal-gate";
import type { UpsertEditorDecisionInput } from "./upsert-editor-decision.input";
import type { EditorListPage, EditorListQuery } from "./editor-list-query";
import type {
  EditorReprecalIntentoRow,
  EditorReprecalMeta,
} from "./editor-reprecal-read-model";
import type { ExpedienteMock } from "./mock.repo";
import type {
  RechazoOperativoInput,
  ReingresoElegibilidad,
} from "./reingreso-post-biometricos";
import type {
  CancelacionOperativaInput,
  ExpedienteCancelacionRow,
} from "./mesa-cancelacion-operativa";
import type {
  ListForAsesorPaginatedOptions,
  PaginatedExpedientesResult,
} from "./list-for-asesor-paginated";
import type {
  AsesorInboxSummaryResult,
  AsesorListExpedientesPageInput,
  AsesorListExpedientesPageResult,
} from "./asesor-inbox-rpc";
import type {
  ListForMesaControlPaginatedQuery,
  PaginatedMesaBandejaResult,
} from "./list-for-mesa-control-paginated";
import type {
  MesaMovimientoHistorialRow,
  MesaMovimientoInput,
  MesaMovimientoResultado,
} from "./mesa-movimiento-etapa";

export type {
  ListForAsesorPaginatedOptions,
  PaginatedExpedientesResult,
} from "./list-for-asesor-paginated";
export type {
  AsesorInboxSummaryResult,
  AsesorListExpedientesPageInput,
  AsesorListExpedientesPageResult,
} from "./asesor-inbox-rpc";
export type {
  ListForMesaControlPaginatedQuery,
  PaginatedMesaBandejaResult,
} from "./list-for-mesa-control-paginated";

/** Contrato expedientes — lectura admin/asesor/detalle (P3B/P3D) + creación asesor (P3C) + envío Mesa (P3E) + editor (P3F) + bandeja Mesa (P3J.1). */
export interface ExpedientesRepo {
  listForAdmin(): Promise<ExpedienteMock[]>;
  listForAsesor(asesorEmail: string): Promise<ExpedienteMock[]>;
  listForAsesorPaginated(
    asesorEmail: string,
    options: ListForAsesorPaginatedOptions,
  ): Promise<PaginatedExpedientesResult>;
  /**
   * B1.5/B1 UI: página filtrada inbox asesor vía RPC.
   * Identidad solo por JWT (`auth.uid()`); no aceptar email/asesor como autoridad.
   */
  listAsesorInboxPage(
    input: AsesorListExpedientesPageInput,
  ): Promise<AsesorListExpedientesPageResult>;
  /** B1.5/B1 UI: KPIs/chips + programas + notifications globales. */
  getAsesorInboxSummary(
    notifLimit?: number,
  ): Promise<AsesorInboxSummaryResult>;
  /** P197: estado efectivo del inbox (detalle consume el mismo helper SQL). */
  getAsesorInboxEstadoEfectivo(expedienteId: string): Promise<string | null>;
  /** P210: read-model causal detalle (motivo exacto + readiness reenvío). */
  getAsesorCorreccionDetalle(
    expedienteId: string,
  ): Promise<import("./asesor-correccion-detalle").AsesorCorreccionDetalle | null>;
  /** P210: reenvío canónico de corrección a Mesa. */
  reenviarCorreccionAMesa(
    expedienteId: string,
  ): Promise<import("./asesor-correccion-detalle").AsesorReenviarCorreccionResult>;
  listForEditor(query: EditorListQuery): Promise<EditorListPage>;
  /** P185/P186: batch SELECT intentos (resueltos REALES + pending draft). */
  listEditorReprecalMeta(
    expedienteIds: readonly string[],
  ): Promise<{
    resolvedByExpedienteId: Readonly<Record<string, EditorReprecalMeta>>;
    pendingIntentoByExpedienteId: Readonly<
      Record<string, EditorReprecalIntentoRow>
    >;
    intentos: readonly EditorReprecalIntentoRow[];
  }>;
  listForMesaControl(): Promise<ExpedienteMock[]>;
  /** P102: bandeja Mesa con filtros en servidor + keyset (25). */
  listForMesaControlPaginated(
    query: ListForMesaControlPaginatedQuery,
  ): Promise<PaginatedMesaBandejaResult>;
  /**
   * P205-B1: KPIs/chips Mesa vía `mesa_bandeja_counts_fast`.
   * Fallback SOLO si la RPC no existe (PGRST202) → list includeCounts=true limit 1.
   */
  getMesaBandejaCounts(input: {
    todayYmd: string | null;
    origen: string | null;
  }): Promise<import("./list-for-mesa-control-paginated").MesaBandejaServerCounts | null>;
  getById(id: string): Promise<ExpedienteMock | null>;
  createExpediente(input: CreateExpedienteInput): Promise<ExpedienteMock>;
  /** P155: gate RO antes de crear / re-precalificar por NSS. */
  lookupNssPrecalGate(
    nss: string,
    programa: ExpedienteProgramaUi,
  ): Promise<NssPrecalGateResult>;
  /** P155: re-precalificar NSS propio ya en Mesa (mismo expediente). */
  iniciarReprecalificacion(
    input: IniciarReprecalificacionInput,
  ): Promise<IniciarReprecalificacionResult>;
  enviarAMesa(expedienteId: string): Promise<ExpedienteMock>;
  /** Reingreso manual del mismo expediente a Mesa (mig. 142). */
  enviarReingresoAMesa(expedienteId: string): Promise<ExpedienteMock>;
  /** P3K.1: Mesa avanza integración 1→2 vía RPC `avanzar_etapa_operativa`. */
  avanzarEtapaOperativa(
    expedienteId: string,
    comentario?: string | null,
  ): Promise<ExpedienteMock>;
  /**
   * P166: Mesa registra Sí pagó / No pagó y avanza Firmado(11)→Pago ConCasa(12).
   * RPC `decidir_pago_concasa`.
   */
  decidirPagoConcasa(
    expedienteId: string,
    resultado: "pagado" | "no_pagado",
    comentario?: string | null,
  ): Promise<ExpedienteMock>;
  mesaMoverEtapaOperativa(
    expedienteId: string,
    input: MesaMovimientoInput,
  ): Promise<MesaMovimientoResultado>;
  listMesaMovimientos(
    expedienteId: string,
  ): Promise<readonly MesaMovimientoHistorialRow[]>;
  upsertEditorDecision(
    expedienteId: string,
    input: UpsertEditorDecisionInput,
  ): Promise<ExpedienteMock>;
  /** P186: borrador pending. No resuelve. No upsert_editor_decision. */
  guardarBorradorReprecalificacion(
    expedienteId: string,
    input: { monto_aprobado: number | null; notas: string },
  ): Promise<{
    ok: true;
    expediente_id: string;
    intento_id: string;
    decision: "pendiente";
    monto_aprobado?: number | string | null;
    notas_revision?: string;
  }>;
  /** Asesor dueño registra monto_aprobado sin cambiar decision del editor. */
  asesorUpdateMontoAprobado(
    expedienteId: string,
    montoAprobado: number,
  ): Promise<ExpedienteMock>;
  rechazarEtapaOperativa(
    expedienteId: string,
    input: RechazoOperativoInput,
  ): Promise<ExpedienteMock>;
  reactivarExpedienteRechazado(expedienteId: string): Promise<ExpedienteMock>;
  /**
   * P204-C read-only: último rechazo operativo y si tiene reactivación.
   * Causalidad real (no solo subestado).
   */
  getRechazoOperativoAbierto(
    expedienteId: string,
  ): Promise<{
    abierto: boolean;
    rechazoId: string | null;
    rechazoAt: string | null;
  }>;
  cancelarExpedienteOperativo(
    expedienteId: string,
    input: CancelacionOperativaInput,
  ): Promise<ExpedienteMock>;
  getUltimaCancelacionOperativa(
    expedienteId: string,
  ): Promise<ExpedienteCancelacionRow | null>;
  getReingresoPostBiometricosElegibilidad(
    expedienteId: string,
  ): Promise<ReingresoElegibilidad>;
  iniciarReingresoPostBiometricos(
    expedienteAnteriorId: string,
    nota?: string | null,
  ): Promise<ExpedienteMock>;
}
