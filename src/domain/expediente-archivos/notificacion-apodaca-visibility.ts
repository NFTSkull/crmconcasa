import {
  resolveCanonicalSedeId,
  type CynthiaSedeId,
} from "@/lib/agendaCynthiaLocations";
import { CLIENTE_NOTIFICACION_APODACA_DOCUMENT_TIPO } from "./integration-docs-completos";
import type { IntegrationDocChecklistItem } from "./integration-docs-completos";
import { mesaPuedeAbrirArchivo } from "./mesa-archivo-acceso";
import type { ExpedienteArchivoResumen } from "./types";

/**
 * Resuelve sede canónica desde `location_id` real (booking), nunca desde label UI.
 * Conservado por compatibilidad; la Notificación compartida no depende de sede.
 */
export function resolveExpedienteSedeFromLocationId(
  locationId: string | null | undefined,
): CynthiaSedeId | null {
  const raw = String(locationId ?? "").trim();
  if (!raw) return null;
  return resolveCanonicalSedeId(raw, "");
}

/**
 * Upload/reemplazo editable de `cliente_notificacion_apodaca` («Notificación»):
 * siempre permitido en UI (cualquier etapa / sede). Permisos reales: asesor dueño
 * o Mesa autorizada vía RPC/RLS.
 *
 * Params opcionales se aceptan por compatibilidad de callers y se ignoran.
 */
export function shouldShowNotificacionApodacaUpload(params?: {
  etapaActual?: number | null | undefined;
  locationId?: string | null | undefined;
}): boolean {
  void params;
  return true;
}

/** @deprecated Histórico RO ya no aplica: la tarjeta es siempre editable para el dueño. */
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
 * Checklist opcionales asesor: siempre conserva `cliente_notificacion_apodaca`
 * (opcional compartido Asesor|Mesa; cualquier etapa/sede).
 */
export function filterChecklistOpcionalesNotificacionApodaca(
  checklist: readonly IntegrationDocChecklistItem[],
  _params?: {
    etapaActual?: number | null | undefined;
    locationId?: string | null | undefined;
    hasArchivoActivo?: boolean;
  },
): IntegrationDocChecklistItem[] {
  void _params;
  return checklist.slice();
}
