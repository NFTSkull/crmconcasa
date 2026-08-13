/**
 * Campana asesor: requisitos inscripción abiertos → DashboardNotificationItem.
 */
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";
import { INSCRIPCION_REBOOK_TASK_KIND } from "./types";
import type { AgendaInscripcionRequirement } from "./types";

export const INSCRIPCION_REBOOK_DASHBOARD_PRIORITY = 4;

export function mapInscripcionRequirementToDashboardNotification(
  req: AgendaInscripcionRequirement,
  meta?: { clienteNombre?: string | null },
): DashboardNotificationItem {
  const cliente = (meta?.clienteNombre ?? "").trim() || "—";
  return {
    id: `inscripcion-req:${req.id}`,
    expedienteId: req.expedienteId,
    clienteNombre: cliente,
    kind: INSCRIPCION_REBOOK_TASK_KIND,
    tipoLabel: "Cita de inscripción pendiente",
    mensaje:
      "El cliente necesita regresar para concluir su inscripción.",
    fecha: req.requestedAt?.slice(0, 10) ?? null,
    prioridad: INSCRIPCION_REBOOK_DASHBOARD_PRIORITY,
    href: `/asesor/expediente/${encodeURIComponent(req.expedienteId)}`,
  };
}

export function mergeInscripcionBellNotifications(
  existing: readonly DashboardNotificationItem[],
  requirements: readonly AgendaInscripcionRequirement[],
  clienteNombreByExpedienteId?: ReadonlyMap<string, string>,
): DashboardNotificationItem[] {
  const mapped = requirements
    .filter(
      (r) => r.status === "pending_booking" || r.status === "rebook_required",
    )
    .map((r) =>
      mapInscripcionRequirementToDashboardNotification(r, {
        clienteNombre: clienteNombreByExpedienteId?.get(r.expedienteId),
      }),
    );

  const withoutOld = existing.filter(
    (n) => n.kind !== INSCRIPCION_REBOOK_TASK_KIND,
  );
  return [...mapped, ...withoutOld];
}
