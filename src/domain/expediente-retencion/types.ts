/** Opción del flujo Acuse / Aviso de retención (etapa operativa 8). */
export type RetencionOpcion = "con_sello" | "sin_sello";

export type ExpedienteRetencionOpcion = Readonly<{
  expedienteId: string;
  retencion_opcion: RetencionOpcion;
  updatedAt: string;
}>;

export type SaveExpedienteRetencionOpcionInput = Readonly<{
  expedienteId: string;
  retencion_opcion: RetencionOpcion;
}>;

export interface ExpedienteRetencionOpcionRepo {
  getByExpedienteId(expedienteId: string): Promise<ExpedienteRetencionOpcion | null>;
  save(input: SaveExpedienteRetencionOpcionInput): Promise<ExpedienteRetencionOpcion>;
}

export type RetencionEnvioMesaEstado = "enviado" | "correccion_requerida";

/** Envío del bloque Acuse/Aviso (etapa 8) desde asesor hacia Mesa; independiente de `submittedToMesa`. */
export type ExpedienteRetencionEnvioMesa = Readonly<{
  expedienteId: string;
  enviado: boolean;
  fechaEnvioMesa: string;
  opcion: RetencionOpcion;
  estado: RetencionEnvioMesaEstado;
}>;

export type SaveExpedienteRetencionEnvioMesaInput = Readonly<{
  expedienteId: string;
  opcion: RetencionOpcion;
  estado?: RetencionEnvioMesaEstado;
}>;

export interface ExpedienteRetencionEnvioMesaRepo {
  getByExpedienteId(expedienteId: string): Promise<ExpedienteRetencionEnvioMesa | null>;
  save(input: SaveExpedienteRetencionEnvioMesaInput): Promise<ExpedienteRetencionEnvioMesa>;
  /** Tras rechazo mesa de un `retencion_*`; conserva `fechaEnvioMesa`. */
  markCorreccionRequerida(expedienteId: string): Promise<ExpedienteRetencionEnvioMesa | null>;
}
