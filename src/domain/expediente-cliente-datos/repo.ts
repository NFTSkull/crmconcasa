import type {
  ExpedienteClienteDatos,
  ExpedienteClienteDatosEstado,
  ClienteDatosEstadoBatch,
  SaveExpedienteClienteDatosInput,
  UpdateEstadoExpedienteClienteDatosInput,
} from "./types";

export interface ExpedienteClienteDatosRepo {
  getByExpedienteId(expedienteId: string): Promise<ExpedienteClienteDatos | null>;
  listEstadoByExpedienteIds(
    expedienteIds: readonly string[],
  ): Promise<Record<string, ExpedienteClienteDatosEstado>>;
  listEstadoBatchByExpedienteIds(
    expedienteIds: readonly string[],
  ): Promise<Record<string, ClienteDatosEstadoBatch>>;
  save(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos>;
  saveCorreccion(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos>;
  updateEstado(input: UpdateEstadoExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos | null>;
}

