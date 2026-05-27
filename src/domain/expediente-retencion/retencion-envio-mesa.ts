import {
  findRowPorTipoDocumento,
  type TipoDocumentoCatalogo,
} from "@/domain/expediente-archivos/types";
import { tiposRequeridosRetencion } from "@/domain/expediente-archivos/retencion-acuse-aviso";
import type { RetencionFaltanteItem } from "@/domain/expediente-archivos/retencion-acuse-aviso";
import type {
  ExpedienteRetencionEnvioMesa,
  RetencionEnvioMesaEstado,
  RetencionOpcion,
} from "./types";

export type RetencionEnvioMesaUiEstado = "no_enviado" | RetencionEnvioMesaEstado;

type ArchivoRowMin = {
  tipo_documento: TipoDocumentoCatalogo;
  estatus_revision?: string;
};

/**
 * Opción canónica para Mesa en etapa 8: lo enviado oficialmente prima sobre la selección local.
 */
export function retencionOpcionMesaEfectiva(
  envio: ExpedienteRetencionEnvioMesa | null | undefined,
  opcionPersistida: RetencionOpcion | null | undefined,
): RetencionOpcion | null {
  return envio?.opcion ?? opcionPersistida ?? null;
}

export function puedeEnviarRetencionAcuseAvisoAMesa(
  faltantes: readonly RetencionFaltanteItem[],
): boolean {
  return faltantes.length === 0;
}

/** Si hay rechazo en docs de la opción, el envío previo cuenta como corrección requerida. */
export function retencionEnvioEstadoEfectivo(
  envio: ExpedienteRetencionEnvioMesa | null | undefined,
  archivos: readonly ArchivoRowMin[],
  opcionPersistida: RetencionOpcion | null | undefined,
): RetencionEnvioMesaUiEstado {
  if (!envio?.enviado) return "no_enviado";
  const opcion = retencionOpcionMesaEfectiva(envio, opcionPersistida);
  if (!opcion) return "enviado";

  for (const tipo of tiposRequeridosRetencion(opcion)) {
    const row = findRowPorTipoDocumento(archivos, tipo);
    if (row?.estatus_revision === "rechazado") {
      return "correccion_requerida";
    }
  }
  return envio.estado === "correccion_requerida" ? "correccion_requerida" : "enviado";
}

export function rechazoRetencionMesaPermitido(comentario: string): boolean {
  return comentario.trim().length > 0;
}

export function retencionPuedeReenviarAMesa(
  uiEstado: RetencionEnvioMesaUiEstado,
  faltantes: readonly RetencionFaltanteItem[],
): boolean {
  if (faltantes.length > 0) return false;
  return uiEstado === "no_enviado" || uiEstado === "correccion_requerida";
}
