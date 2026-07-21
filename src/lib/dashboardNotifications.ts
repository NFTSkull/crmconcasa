import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";
import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos";

export const DASHBOARD_NOTIFICATION_MAX = 5;

export type DashboardNotificationAudience = "asesor" | "mesa";

export type DashboardNotificationKind =
  | "correccion_requerida"
  | "rechazado_mesa"
  | "cancelado"
  | "correccion_enviada"
  | "nuevo_por_revisar"
  | "pendiente_revision"
  | "enviado_mesa"
  | "cita_hoy"
  | "cita_cambio"
  | "cita_programada";

export type DashboardNotificationItem = {
  id: string;
  expedienteId: string;
  clienteNombre: string;
  kind: DashboardNotificationKind;
  tipoLabel: string;
  mensaje: string;
  fecha: string | null;
  prioridad: number;
  href: string;
};

export type DashboardNotificationExpedienteSource = {
  expedienteId: string;
  clienteNombre: string;
  etapaActual?: number | null;
  subestado?: string | null;
  /** P094: ciclo cancelado no genera alerta de rechazo recuperable. */
  cicloEstado?: string | null;
  submittedToMesa?: boolean;
  fechaCita?: string | null;
  fechaEnvioMesa?: string | null;
  updatedAt?: string | null;
  resumenCorreccion?: CategoriaResumenDocumental | null;
  clienteDatosEstado?: ExpedienteClienteDatosEstado | null;
};

type NotificationCandidate = Omit<DashboardNotificationItem, "id" | "expedienteId" | "clienteNombre" | "href">;

export function getTodayYMDForNotifications(refDate = new Date()): string {
  return `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, "0")}-${String(refDate.getDate()).padStart(2, "0")}`;
}

export function fechaToYMD(value?: string | null): string | null {
  if (!value || !String(value).trim()) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  const d = new Date(parsed);
  return getTodayYMDForNotifications(d);
}

function resolveNotificationFecha(source: DashboardNotificationExpedienteSource): string | null {
  return source.updatedAt ?? source.fechaEnvioMesa ?? source.fechaCita ?? null;
}

function isCitaEtapa(etapa?: number | null): boolean {
  const n = Number(etapa) || 0;
  return n === 4 || n === 5 || n === 9 || n === 10;
}

function isEnvioMesaReciente(fechaEnvioMesa?: string | null, ventanaDias = 7): boolean {
  if (!fechaEnvioMesa?.trim()) return false;
  const t = Date.parse(fechaEnvioMesa);
  if (Number.isNaN(t)) return false;
  const limite = Date.now() - ventanaDias * 24 * 60 * 60 * 1000;
  return t >= limite;
}

function compareFechaDesc(a?: string | null, b?: string | null): number {
  const ta = a ? Date.parse(a) : 0;
  const tb = b ? Date.parse(b) : 0;
  const na = Number.isNaN(ta) ? 0 : ta;
  const nb = Number.isNaN(tb) ? 0 : tb;
  return nb - na;
}

function buildCandidates(
  source: DashboardNotificationExpedienteSource,
  audience: DashboardNotificationAudience,
  todayYMD: string,
  isNuevoEtapa12?: (source: DashboardNotificationExpedienteSource) => boolean,
): NotificationCandidate[] {
  const out: NotificationCandidate[] = [];
  const fecha = resolveNotificationFecha(source);
  const datosRechazados = source.clienteDatosEstado === "rechazado";
  const docsRechazados = source.resumenCorreccion === "correccion_requerida";
  const sub = String(source.subestado ?? "pendiente").trim();
  const ciclo = String(source.cicloEstado ?? "").trim();
  const cancelado = ciclo === "cancelado";

  if (cancelado) {
    out.push({
      kind: "cancelado",
      prioridad: 1,
      tipoLabel: "Expediente cancelado",
      mensaje: "Expediente cancelado (terminal) — solo lectura",
      fecha,
    });
    return out;
  }

  if (datosRechazados && docsRechazados) {
    out.push({
      kind: "correccion_requerida",
      prioridad: 1,
      tipoLabel: "Corrección requerida",
      mensaje: "Datos generales y documentos requieren corrección",
      fecha,
    });
  } else if (datosRechazados) {
    out.push({
      kind: "correccion_requerida",
      prioridad: 1,
      tipoLabel: "Corrección requerida",
      mensaje: "Datos generales requieren corrección",
      fecha,
    });
  } else if (docsRechazados) {
    out.push({
      kind: "correccion_requerida",
      prioridad: 1,
      tipoLabel: "Corrección requerida",
      mensaje: "Documentos requieren corrección",
      fecha,
    });
  }

  if (sub === "rechazado") {
    out.push({
      kind: "rechazado_mesa",
      prioridad: 2,
      tipoLabel: "Rechazado por Mesa",
      mensaje: "Expediente rechazado o bloqueado por Mesa",
      fecha,
    });
  }

  if (source.resumenCorreccion === "correccion_enviada") {
    out.push({
      kind: "correccion_enviada",
      prioridad: 3,
      tipoLabel: "Corrección enviada",
      mensaje:
        audience === "mesa"
          ? "El asesor envió corrección — pendiente de revisión"
          : "Corrección enviada — Mesa debe revisar",
      fecha,
    });
  }

  if (audience === "mesa" && isNuevoEtapa12?.(source)) {
    out.push({
      kind: "nuevo_por_revisar",
      prioridad: 4,
      tipoLabel: "Nuevo por revisar",
      mensaje: "Expediente nuevo en etapas 1–2 pendiente de revisión",
      fecha: source.fechaEnvioMesa ?? fecha,
    });
  }

  if (audience === "mesa" && source.resumenCorreccion === "pendiente_revision_documental") {
    out.push({
      kind: "pendiente_revision",
      prioridad: 4,
      tipoLabel: "Pendiente de revisión",
      mensaje: "Documentos pendientes de revisión por Mesa",
      fecha,
    });
  }

  if (
    audience === "asesor" &&
    source.submittedToMesa &&
    sub === "en_validacion_mesa" &&
    !docsRechazados &&
    !datosRechazados &&
    source.resumenCorreccion !== "correccion_enviada"
  ) {
    out.push({
      kind: "enviado_mesa",
      prioridad: 5,
      tipoLabel: "En validación Mesa",
      mensaje: "Expediente enviado a Mesa — en validación",
      fecha: source.fechaEnvioMesa ?? fecha,
    });
  }

  if (audience === "mesa" && source.submittedToMesa && isEnvioMesaReciente(source.fechaEnvioMesa)) {
    out.push({
      kind: "enviado_mesa",
      prioridad: 5,
      tipoLabel: "Enviado a Mesa",
      mensaje: "Expediente enviado recientemente a Mesa",
      fecha: source.fechaEnvioMesa ?? fecha,
    });
  }

  const citaYmd = fechaToYMD(source.fechaCita);
  if (citaYmd && citaYmd === todayYMD) {
    out.push({
      kind: "cita_hoy",
      prioridad: 6,
      tipoLabel: "Cita hoy",
      mensaje: "Cita programada para hoy",
      fecha: source.fechaCita ?? fecha,
    });
  }

  if (
    audience === "asesor" &&
    source.submittedToMesa &&
    isCitaEtapa(source.etapaActual) &&
    !source.fechaCita?.trim()
  ) {
    out.push({
      kind: "cita_cambio",
      prioridad: 6,
      tipoLabel: "Cambio en cita",
      mensaje: "Cita cancelada o pendiente de reagendar",
      fecha,
    });
  }

  if (citaYmd && citaYmd !== todayYMD && isCitaEtapa(source.etapaActual)) {
    out.push({
      kind: "cita_programada",
      prioridad: 7,
      tipoLabel: "Cita agendada",
      mensaje: `Cita agendada (${citaYmd})`,
      fecha: source.fechaCita ?? fecha,
    });
  }

  return out;
}

function pickBestCandidate(candidates: NotificationCandidate[]): NotificationCandidate | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => a.prioridad - b.prioridad)[0] ?? null;
}

function buildHref(audience: DashboardNotificationAudience, expedienteId: string): string {
  return audience === "asesor"
    ? `/asesor/expediente/${expedienteId}`
    : `/mesa-control/${expedienteId}`;
}

export function buildBestDashboardNotification(
  source: DashboardNotificationExpedienteSource,
  audience: DashboardNotificationAudience,
  options?: {
    todayYMD?: string;
    isNuevoEtapa12?: (source: DashboardNotificationExpedienteSource) => boolean;
  },
): DashboardNotificationItem | null {
  const todayYMD = options?.todayYMD ?? getTodayYMDForNotifications();
  const best = pickBestCandidate(
    buildCandidates(source, audience, todayYMD, options?.isNuevoEtapa12),
  );
  if (!best) return null;
  return {
    id: `${source.expedienteId}:${best.kind}`,
    expedienteId: source.expedienteId,
    clienteNombre: source.clienteNombre,
    href: buildHref(audience, source.expedienteId),
    ...best,
  };
}

export function buildDashboardNotifications(
  sources: readonly DashboardNotificationExpedienteSource[],
  audience: DashboardNotificationAudience,
  options?: {
    todayYMD?: string;
    max?: number;
    isNuevoEtapa12?: (source: DashboardNotificationExpedienteSource) => boolean;
  },
): DashboardNotificationItem[] {
  const max = options?.max ?? DASHBOARD_NOTIFICATION_MAX;
  return sources
    .map((source) => buildBestDashboardNotification(source, audience, options))
    .filter((item): item is DashboardNotificationItem => item != null)
    .sort((a, b) => a.prioridad - b.prioridad || compareFechaDesc(a.fecha, b.fecha))
    .slice(0, max);
}
