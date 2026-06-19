import type { CreateExpedienteInput } from "./create-expediente.input";
import type { ExpedienteMock } from "./mock.repo";

/** Contrato expedientes — lectura admin/asesor/detalle (P3B/P3D) + creación asesor (P3C). */
export interface ExpedientesRepo {
  listForAdmin(): Promise<ExpedienteMock[]>;
  listForAsesor(asesorEmail: string): Promise<ExpedienteMock[]>;
  getById(id: string): Promise<ExpedienteMock | null>;
  createExpediente(input: CreateExpedienteInput): Promise<ExpedienteMock>;
}
