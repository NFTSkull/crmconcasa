import type {
  ExpedienteClienteDatos,
  ExpedienteClienteDatosEstado,
  SaveExpedienteClienteDatosInput,
  UpdateEstadoExpedienteClienteDatosInput,
} from "./types";

export interface ExpedienteClienteDatosRepo {
  getByExpedienteId(expedienteId: string): Promise<ExpedienteClienteDatos | null>;
  listEstadoByExpedienteIds(
    expedienteIds: readonly string[],
  ): Promise<Record<string, ExpedienteClienteDatosEstado>>;
  save(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos>;
  saveCorreccion(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos>;
  updateEstado(input: UpdateEstadoExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos | null>;
}

