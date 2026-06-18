import type { CreateExpedienteInput } from "./create-expediente.input";
import type { ExpedienteMock } from "./mock.repo";

/** Contrato expedientes — lectura admin (P3B) + creación asesor (P3C). */
export interface ExpedientesRepo {
  listForAdmin(): Promise<ExpedienteMock[]>;
  createExpediente(input: CreateExpedienteInput): Promise<ExpedienteMock>;
}
