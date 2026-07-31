import {
  resolveCanonicalSedeId,
  type CynthiaSedeId,
} from "@/lib/agendaCynthiaLocations";
import { RETENCION_ETAPA_OPERATIVA_ID } from "./retencion-acuse-aviso";
import { CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO } from "./integration-docs-completos";
import type { IntegrationDocChecklistItem } from "./integration-docs-completos";
import { mesaPuedeAbrirArchivo } from "./mesa-archivo-acceso";
import type { ExpedienteArchivoResumen } from "./types";

/** Etapa de retención/acuses: control de carga de Notificación (`cliente_notificacion_apodaca`). */
export const NOTIFICACION_APODACA_UPLOAD_ETAPA = RETENCION_ETAPA_OPERATIVA_ID;

/**
 * Resuelve sede canónica desde `location_id` real (booking), nunca desde label UI.
 * Conservado por compatibilidad; la visibilidad de upload ya no depende de sede.
 */
export function resolveExpedienteSedeFromLocationId(
  locationId: string | null | undefined,
): CynthiaSedeId | null {
  const raw = String(locationId ?? "").trim();
  if (!raw) return null;
  return resolveCanonicalSedeId(raw, "");
}

/**
 * Upload editable de `cliente_notificacion_apodaca` únicamente si
 * etapa operativa = 8 (retención/acuses), para cualquier sede.
 *
 * Etapa distinta → false (histórico RO si ya hay archivo).
 *
 * `locationId` se acepta por compatibilidad de callers y se ignora.
 */
export function shouldShowNotificacionApodacaUpload(params: {
  etapaActual: number | null | undefined;
  locationId?: string | null | undefined;
}): boolean {
  void params.locationId;
  return params.etapaActual === NOTIFICACION_APODACA_UPLOAD_ETAPA;
}

/** Histórico RO: hay archivo activo y no corresponde mostrar upload editable. */
export function shouldShowNotificacionApodacaHistorico(params: {
  hasArchivoActivo: boolean;
  canUpload: boolean;
}): boolean {
  return params.hasArchivoActivo && !params.canUpload;
}

export function hasNotificacionApodacaArchivoActivo(
  archivos: readonly ExpedienteArchivoResumen[] | null | undefined,
): boolean {
  if (!archivos?.length) return false;
  const row = archivos.find(
    (a) => a.tipo_documento === CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO,
  );
  return Boolean(row && mesaPuedeAbrirArchivo(row));
}

/**
 * Filtra checklist opcionales asesor:
 * - upload editable solo en etapa 8 (cualquier sede);
 * - si hay archivo y no hay upload, conserva ítem (UI lo trata RO vía `readOnlyTipos`).
 */
export function filterChecklistOpcionalesNotificacionApodaca(
  checklist: readonly IntegrationDocChecklistItem[],
  params: {
    etapaActual: number | null | undefined;
    locationId?: string | null | undefined;
    hasArchivoActivo: boolean;
  },
): IntegrationDocChecklistItem[] {
  const canUpload = shouldShowNotificacionApodacaUpload(params);
  const keepHistorico = shouldShowNotificacionApodacaHistorico({
    hasArchivoActivo: params.hasArchivoActivo,
    canUpload,
  });

  return checklist.filter((item) => {
    if (item.tipo_documento !== CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO) {
      return true;
    }
    return canUpload || keepHistorico;
  });
}
