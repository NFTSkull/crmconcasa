/** Contrato de lectura P090: get_expediente_monto_mejoravit_context */

export type MontoMejoravitHistorialEntry = Readonly<{
  id: string;
  montoAnterior: number;
  montoNuevo: number;
  diferencia: number;
  porcentajeCobro: number;
  montoCobroAnterior: number | null;
  montoCobroNuevo: number;
  motivo: string;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
}>;

export type MontoMejoravitUltimaActualizacion = Readonly<{
  montoNuevo: number;
  motivo: string;
  updatedAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
}>;

export type ExpedienteMontoMejoravitContext = Readonly<{
  expedienteId: string;
  montoAprobadoEditor: number | null;
  montoSnapshotPrimeraAprobacion: number | null;
  montoMejoravitDatosGenerales: number | null;
  montoMejoravitActualizado: number | null;
  montoOperativoVigente: number | null;
  montoOriginalOperativo: number | null;
  porcentajeCobro: number | null;
  cargoFijo: number;
  montoCalculado: number | null;
  ultimaActualizacion: MontoMejoravitUltimaActualizacion | null;
  historial: readonly MontoMejoravitHistorialEntry[];
  canUpdate: boolean;
}>;

export type ActualizarMontoMejoravitMesaParams = Readonly<{
  expedienteId: string;
  montoNuevo: number;
  motivo: string;
}>;

export type ActualizarMontoMejoravitMesaResult = Readonly<{
  ok: boolean;
  expedienteId: string;
  montoOriginalOperativo: number;
  montoAnterior: number;
  montoNuevo: number;
  diferencia: number;
  porcentajeCobro: number;
  montoCobroAnterior: number | null;
  montoCobroNuevo: number;
  motivo: string;
  updatedBy: string | null;
  updatedAt: string | null;
}>;
