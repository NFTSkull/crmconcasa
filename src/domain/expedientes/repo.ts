import type { CreateExpedienteInput } from "./create-expediente.input";
import type { UpsertEditorDecisionInput } from "./upsert-editor-decision.input";
import type { EditorListPage, EditorListQuery } from "./editor-list-query";
import type { ExpedienteMock } from "./mock.repo";
import type {
  RechazoOperativoInput,
  ReingresoElegibilidad,
} from "./reingreso-post-biometricos";
import type {
  ListForAsesorPaginatedOptions,
  PaginatedExpedientesResult,
} from "./list-for-asesor-paginated";

export type {
  ListForAsesorPaginatedOptions,
  PaginatedExpedientesResult,
} from "./list-for-asesor-paginated";

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
  getById(id: string): Promise<ExpedienteMock | null>;
  createExpediente(input: CreateExpedienteInput): Promise<ExpedienteMock>;
  enviarAMesa(expedienteId: string): Promise<ExpedienteMock>;
  /** P3K.1: Mesa avanza integración 1→2 vía RPC `avanzar_etapa_operativa`. */
  avanzarEtapaOperativa(
    expedienteId: string,
    comentario?: string | null,
  ): Promise<ExpedienteMock>;
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
  getReingresoPostBiometricosElegibilidad(
    expedienteId: string,
  ): Promise<ReingresoElegibilidad>;
  iniciarReingresoPostBiometricos(
    expedienteAnteriorId: string,
    nota?: string | null,
  ): Promise<ExpedienteMock>;
}
