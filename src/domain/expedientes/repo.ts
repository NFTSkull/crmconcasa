import type { CreateExpedienteInput } from "./create-expediente.input";
import type { UpsertEditorDecisionInput } from "./upsert-editor-decision.input";
import type { EditorListPage, EditorListQuery } from "./editor-list-query";
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
  listForEditor(query: EditorListQuery): Promise<EditorListPage>;
  listForMesaControl(): Promise<ExpedienteMock[]>;
  /** P102: bandeja Mesa con filtros en servidor + keyset (25). */
  listForMesaControlPaginated(
    query: ListForMesaControlPaginatedQuery,
  ): Promise<PaginatedMesaBandejaResult>;
  getById(id: string): Promise<ExpedienteMock | null>;
  createExpediente(input: CreateExpedienteInput): Promise<ExpedienteMock>;
  enviarAMesa(expedienteId: string): Promise<ExpedienteMock>;
  /** P3K.1: Mesa avanza integración 1→2 vía RPC `avanzar_etapa_operativa`. */
  avanzarEtapaOperativa(
    expedienteId: string,
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
