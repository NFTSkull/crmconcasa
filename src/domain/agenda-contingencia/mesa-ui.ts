/**
 * P172 B2 — helpers mesa (día único, roles, copy).
 */
import { canAccessMesaAgendaCitasPage } from "@/lib/mesaAgendaCitasUi";
import type { ContingenciaPendienteItem } from "./types";
import { EXTRAORDINARY_REBOOK_TASK_KIND } from "./types";
import { mapContingenciaPendienteToDashboardNotification } from "./notification-map";
import type { DashboardNotificationItem } from "@/lib/dashboardNotifications";

const MESA_CONTINGENCY_ROLES = new Set([
  "mesa_admin",
  "mesa_interno",
  "mesa_externo",
  "super_admin",
  "mesa_control",
  "mesa_control_admin",
  "mesa_control_interno",
  "mesa_control_externo",
]);

export function canDeclareAgendaContingencia(
  role: string | null | undefined,
): boolean {
  const r = String(role ?? "").trim();
  if (!r) return false;
  if (MESA_CONTINGENCY_ROLES.has(r)) return true;
  return canAccessMesaAgendaCitasPage(role);
}

export function canDeclareContingenciaOnView(params: Readonly<{
  viewMode: "dia" | "semana" | "lista";
  selectedDay: string;
  listaStartDate: string;
  listaEndDate: string;
  appliedListaStart?: string;
  appliedListaEnd?: string;
}>): Readonly<{ allowed: boolean; reason: string | null; dayYmd: string | null }> {
  if (params.viewMode === "semana") {
    return {
      allowed: false,
      reason: "Selecciona un solo día para declarar una contingencia.",
      dayYmd: null,
    };
  }
  if (params.viewMode === "dia") {
    const d = params.selectedDay.trim();
    return d
      ? { allowed: true, reason: null, dayYmd: d }
      : { allowed: false, reason: "Selecciona un día.", dayYmd: null };
  }
  // lista: solo si borrador y aplicado son el mismo día único
  const start = params.listaStartDate.trim();
  const end = params.listaEndDate.trim();
  if (!start || start !== end) {
    return {
      allowed: false,
      reason: "Selecciona un solo día para declarar una contingencia.",
      dayYmd: null,
    };
  }
  const appliedStart = (params.appliedListaStart ?? start).trim();
  const appliedEnd = (params.appliedListaEnd ?? end).trim();
  if (appliedStart !== start || appliedEnd !== end) {
    return {
      allowed: false,
      reason: "Actualiza la lista al día seleccionado antes de declarar.",
      dayYmd: null,
    };
  }
  return { allowed: true, reason: null, dayYmd: start };
}

export function formatContingenciaKindLabel(
  kind: "biometricos" | "firmas",
): string {
  return kind === "biometricos" ? "Biométricos" : "Firmas";
}

export function formatContingenciaSedeLabel(
  locationId: string | null | undefined,
): string {
  const t = String(locationId ?? "").trim().toLowerCase();
  if (!t) return "Todas las sedes";
  if (t === "monterrey") return "Monterrey";
  if (t === "apodaca") return "Apodaca";
  return t;
}

export function formatContingenciaDayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  const months = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic",
  ];
  const mo = Number(m[2]);
  return `${Number(m[3])} ${months[mo - 1] ?? m[2]} ${m[1]}`.toUpperCase();
}

export function buildExtraordinaryBellCopy(
  item: ContingenciaPendienteItem,
): DashboardNotificationItem {
  const kindLabel = formatContingenciaKindLabel(item.kind);
  const base = mapContingenciaPendienteToDashboardNotification(item);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.affected_date.trim());
  const dateLabel = m ? `${m[3]}/${m[2]}/${m[1]}` : item.affected_date;
  return {
    ...base,
    tipoLabel: "Reagenda extraordinaria",
    mensaje: `Las citas de ${kindLabel} del ${dateLabel} no se realizaron. Selecciona una nueva fecha.`,
    href: `/asesor/expediente/${item.expediente_id}?contingencia=${item.contingency_item_id}`,
    kind: EXTRAORDINARY_REBOOK_TASK_KIND,
  };
}

export function mergeExtraordinaryBellNotifications(
  existing: readonly DashboardNotificationItem[],
  pending: readonly ContingenciaPendienteItem[],
): DashboardNotificationItem[] {
  const extras = pending.map((p) => buildExtraordinaryBellCopy(p));
  const byId = new Map<string, DashboardNotificationItem>();
  for (const n of existing) {
    if (n.kind === EXTRAORDINARY_REBOOK_TASK_KIND) continue;
    byId.set(n.id, n);
  }
  for (const n of extras) byId.set(n.id, n);
  return [...byId.values()].sort(
    (a, b) => a.prioridad - b.prioridad || String(b.fecha).localeCompare(String(a.fecha)),
  );
}
