/**
 * Mapea pendientes Cloud P172 → DashboardNotificationItem.
 * Fuente: agenda_contingencia_citas.pending_rebook (no localStorage).
 * Abrir campana NO resuelve la tarea (solo rebook/closed).
 */
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";
import {
  EXTRAORDINARY_REBOOK_PRIORITY,
  EXTRAORDINARY_REBOOK_TASK_KIND,
  type ContingenciaPendienteItem,
} from "./types";

export const EXTRAORDINARY_REBOOK_DASHBOARD_PRIORITY =
  EXTRAORDINARY_REBOOK_PRIORITY;

export function mapContingenciaPendienteToDashboardNotification(
  item: ContingenciaPendienteItem,
  opts?: { clienteNombre?: string | null },
): DashboardNotificationItem {
  const kind = EXTRAORDINARY_REBOOK_TASK_KIND;
  return {
    id: `${item.expediente_id}:${kind}:${item.contingency_item_id}`,
    expedienteId: item.expediente_id,
    clienteNombre: (opts?.clienteNombre ?? "").trim() || "—",
    kind,
    tipoLabel: "Reagendar cita extraordinaria",
    mensaje: `Contingencia ${item.kind}: reagendar cita (día afectado ${item.affected_date})`,
    fecha: item.affected_date,
    prioridad: EXTRAORDINARY_REBOOK_PRIORITY,
    href: `/asesor/expediente/${item.expediente_id}`,
  };
}
