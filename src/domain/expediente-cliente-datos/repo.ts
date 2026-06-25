import type {
  ExpedienteClienteDatos,
  SaveExpedienteClienteDatosInput,
  UpdateEstadoExpedienteClienteDatosInput,
} from "./types";

export interface ExpedienteClienteDatosRepo {
  getByExpedienteId(expedienteId: string): Promise<ExpedienteClienteDatos | null>;
  save(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos>;
  saveCorreccion(input: SaveExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos>;
  updateEstado(input: UpdateEstadoExpedienteClienteDatosInput): Promise<ExpedienteClienteDatos | null>;
}

