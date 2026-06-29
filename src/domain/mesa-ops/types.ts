/** Estados operativos Mesa (`mesa_expediente_estado` en Postgres). */
export type MesaExpedienteEstado =
  | "sin_asignar"
  | "trabajando"
  | "en_espera_asesor"
  | "en_espera_cliente"
  | "en_espera_reagenda"
  | "bloqueado"
  | "listo_para_avanzar"
  | "completado";

export type MesaExpedienteOpsRow = Readonly<{
  expedienteId: string;
  estadoMesa: MesaExpedienteEstado;
  assignedTo: string | null;
  assignedAt: string | null;
  lastActivityAt: string | null;
  assignedToName: string | null;
}>;

export type MesaTakeExpedienteResult = Readonly<{
  ok: boolean;
  idempotent?: boolean;
  expedienteId: string;
  estadoMesa: MesaExpedienteEstado;
  assignedTo: string | null;
  assignedAt: string | null;
}>;

export type MesaReleaseExpedienteResult = Readonly<{
  ok: boolean;
  expedienteId: string;
  estadoMesa: MesaExpedienteEstado;
  previousAssignedTo: string | null;
}>;
