/**
 * P136: tipos documentales que Mesa puede eliminar (y reemplazar vía register_mesa_documento).
 */
export const MESA_TIPOS_DOCUMENTO_OPERATIVOS_MUTABLES = [
  "cliente_pagare",
  "cliente_notificacion",
  "cliente_notificacion_apodaca",
] as const;

export type MesaTipoDocumentoOperativoMutable =
  (typeof MESA_TIPOS_DOCUMENTO_OPERATIVOS_MUTABLES)[number];

export function isMesaTipoDocumentoOperativoMutable(
  tipo: string,
): tipo is MesaTipoDocumentoOperativoMutable {
  return (MESA_TIPOS_DOCUMENTO_OPERATIVOS_MUTABLES as readonly string[]).includes(tipo);
}

export const MESA_DOCUMENTO_REPLACE_CONFIRM =
  "El documento actual dejará de mostrarse y será reemplazado por la nueva versión.";

export const MESA_DOCUMENTO_ELIMINAR_CONFIRM =
  "¿Eliminar este documento del expediente? Dejará de estar disponible para Mesa y para el asesor.";

export type DeleteMesaDocumentoParams = {
  expedienteId: string;
  tipo_documento: MesaTipoDocumentoOperativoMutable;
};

export type MesaEliminarDocumentoRpcResult = {
  ok: boolean;
  already_absent?: boolean;
  expediente_id?: string;
  tipo_documento?: string;
  documento_id?: string;
  version_eliminada?: number;
  storage_path?: string | null;
};
