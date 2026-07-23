/**
 * P119 — resolución de acciones rápidas en tarjeta de bandeja Mesa.
 * Reutiliza gates espejo de `mesa-avance-integracion` (misma RPC `avanzar_etapa_operativa`).
 */

import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import type { RetencionOpcion } from "@/domain/expediente-retencion/types";
import {
  deriveAvanceOperativo2a3View,
  deriveAvanceOperativo4a5View,
  deriveAvanceOperativo5a6View,
  deriveAvanceOperativo6a7View,
  deriveAvanceOperativo7a8View,
  deriveAvanceOperativo8a9View,
  deriveAvanceOperativo10a11View,
  deriveCierreValidacionDocumentalView,
  type AvanceOperativoEtapaView,
} from "@/domain/expedientes/mesa-avance-integracion";
import { formatPasoOperativoLabel } from "@/domain/expedientes/etapa-numeracion-ux";
import {
  isAssignedToCurrentUser,
  isSinAsignarOps,
} from "@/lib/mesaOpsUi";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";

/** Etapa interna → siguiente etapa en acciones rápidas de bandeja (P119.1).
 * Excluye 3→5 (booking biométricos/notificación) y 9→10 (booking firmas).
 */
export const MESA_SIGUIENTE_ETAPA_MAP: Readonly<Record<number, number>> = {
  1: 2,
  2: 3,
  4: 5,
  5: 6,
  6: 7,
  7: 8,
  8: 9,
  10: 11,
};

export type MesaSiguienteEtapaReasonCode =
  | "faltan_documentos"
  | "falta_cita"
  | "rechazado"
  | "cancelado"
  | "no_disponible";

export type MesaSiguienteEtapaAccion = Readonly<{
  visible: boolean;
  enabled: boolean;
  fromEtapa: number;
  toEtapa: number;
  fromLabel: string;
  toLabel: string;
  reasonCode: MesaSiguienteEtapaReasonCode | null;
  reasonShort: string | null;
  bloqueos: readonly string[];
}>;

export type MesaSiguienteEtapaContext = Readonly<{
  etapaActual: number | null | undefined;
  subestado?: string | null;
  cicloEstado?: string | null;
  submittedToMesa?: boolean;
  fechaCita?: string | null;
  clienteDatosEstado?: string | null;
  archivosResumen?: readonly ExpedienteArchivoResumen[];
  hasActiveBiometricBooking?: boolean;
  hasActiveNotificacionBooking?: boolean;
  hasActiveFirmasBooking?: boolean;
  retencionOpcion?: RetencionOpcion | null;
  retencionEnviadoAMesa?: boolean;
  retencionEnvioEstado?: "enviado" | "correccion_requerida" | null;
  nowMs?: number;
}>;

const REASON_LABELS: Readonly<Record<MesaSiguienteEtapaReasonCode, string>> = {
  faltan_documentos: "Falta validar documentos",
  falta_cita: "Falta cita activa",
  rechazado: "Expediente rechazado",
  cancelado: "Acción no disponible en esta etapa",
  no_disponible: "Acción no disponible en esta etapa",
};

export function mapBloqueosToSiguienteEtapaReason(
  bloqueos: readonly string[],
): MesaSiguienteEtapaReasonCode {
  const text = bloqueos.join(" ").toLowerCase();
  if (
    text.includes("documento") ||
    text.includes("datos generales") ||
    text.includes("retención") ||
    text.includes("retencion") ||
    text.includes("validar") ||
    text.includes("acuse") ||
    text.includes("aviso")
  ) {
    return "faltan_documentos";
  }
  if (
    text.includes("cita") ||
    text.includes("reserva") ||
    text.includes("notificación") ||
    text.includes("notificacion") ||
    text.includes("fecha") ||
    text.includes("ocurrido")
  ) {
    return "falta_cita";
  }
  return "no_disponible";
}

function emptyHidden(from: number, to: number): MesaSiguienteEtapaAccion {
  return {
    visible: false,
    enabled: false,
    fromEtapa: from,
    toEtapa: to,
    fromLabel: formatPasoOperativoLabel(from),
    toLabel: formatPasoOperativoLabel(to),
    reasonCode: null,
    reasonShort: null,
    bloqueos: [],
  };
}

function fromView(
  from: number,
  to: number,
  view: AvanceOperativoEtapaView,
  override?: {
    visible?: boolean;
    enabled?: boolean;
    reasonCode?: MesaSiguienteEtapaReasonCode;
  },
): MesaSiguienteEtapaAccion {
  const visible = override?.visible ?? view.mostrar;
  if (!visible) return emptyHidden(from, to);
  const enabled = override?.enabled ?? view.puedeAvanzar;
  const reasonCode = enabled
    ? null
    : (override?.reasonCode ?? mapBloqueosToSiguienteEtapaReason(view.bloqueos));
  return {
    visible: true,
    enabled,
    fromEtapa: from,
    toEtapa: to,
    fromLabel: formatPasoOperativoLabel(from),
    toLabel: formatPasoOperativoLabel(to),
    reasonCode,
    reasonShort: reasonCode ? REASON_LABELS[reasonCode] : null,
    bloqueos: view.bloqueos,
  };
}

/**
 * Resuelve visibilidad/habilitación de «Siguiente etapa» para una tarjeta.
 * La mutación real sigue siendo `avanzar_etapa_operativa` (gates SQL).
 */
export function resolveMesaSiguienteEtapaAccion(
  ctx: MesaSiguienteEtapaContext,
): MesaSiguienteEtapaAccion {
  const etapa = ctx.etapaActual ?? null;
  if (etapa == null || !Number.isFinite(etapa)) {
    return emptyHidden(0, 0);
  }
  const to = MESA_SIGUIENTE_ETAPA_MAP[etapa];
  if (to == null) return emptyHidden(etapa, etapa);

  if (ctx.cicloEstado != null && ctx.cicloEstado !== "activo") {
    return {
      ...emptyHidden(etapa, to),
      visible: true,
      enabled: false,
      reasonCode: "cancelado",
      reasonShort: REASON_LABELS.cancelado,
      bloqueos: ["Expediente cancelado o cerrado."],
      fromLabel: formatPasoOperativoLabel(etapa),
      toLabel: formatPasoOperativoLabel(to),
    };
  }

  if (ctx.subestado === "rechazado") {
    return {
      visible: true,
      enabled: false,
      fromEtapa: etapa,
      toEtapa: to,
      fromLabel: formatPasoOperativoLabel(etapa),
      toLabel: formatPasoOperativoLabel(to),
      reasonCode: "rechazado",
      reasonShort: REASON_LABELS.rechazado,
      bloqueos: ["Expediente rechazado."],
    };
  }

  const base = {
    submittedToMesa: Boolean(ctx.submittedToMesa),
    cicloEstado: ctx.cicloEstado ?? "activo",
    etapaActual: etapa,
    subestado: ctx.subestado ?? null,
  };

  const archivos = ctx.archivosResumen ?? [];

  if (etapa === 1) {
    const view = deriveCierreValidacionDocumentalView({
      ...base,
      clienteDatosEstado: ctx.clienteDatosEstado ?? null,
      archivosResumen: archivos,
    });
    return fromView(1, 2, {
      mostrar: view.mostrar,
      puedeAvanzar: view.puedeAvanzar,
      bloqueos: view.bloqueos,
    });
  }

  if (etapa === 2) return fromView(2, 3, deriveAvanceOperativo2a3View(base));

  if (etapa === 4) {
    return fromView(
      4,
      5,
      deriveAvanceOperativo4a5View({
        ...base,
        fechaCita: ctx.fechaCita,
        hasActiveBiometricBooking: Boolean(ctx.hasActiveBiometricBooking),
      }),
    );
  }

  if (etapa === 5) {
    return fromView(
      5,
      6,
      deriveAvanceOperativo5a6View({
        ...base,
        fechaCita: ctx.fechaCita,
        hasActiveBiometricBooking: Boolean(ctx.hasActiveBiometricBooking),
        nowMs: ctx.nowMs,
      }),
    );
  }

  if (etapa === 6) return fromView(6, 7, deriveAvanceOperativo6a7View(base));
  if (etapa === 7) return fromView(7, 8, deriveAvanceOperativo7a8View(base));

  if (etapa === 8) {
    return fromView(
      8,
      9,
      deriveAvanceOperativo8a9View({
        ...base,
        clienteDatosEstado: ctx.clienteDatosEstado ?? null,
        archivosResumen: archivos,
        retencionOpcion: ctx.retencionOpcion ?? null,
        retencionEnviadoAMesa: Boolean(ctx.retencionEnviadoAMesa),
        retencionEnvioEstado: ctx.retencionEnvioEstado ?? null,
      }),
    );
  }

  if (etapa === 10) {
    return fromView(
      10,
      11,
      deriveAvanceOperativo10a11View({
        ...base,
        fechaCita: ctx.fechaCita,
        hasActiveFirmasBooking: Boolean(ctx.hasActiveFirmasBooking),
      }),
    );
  }

  return emptyHidden(etapa, to);
}

const TAKE_ROLES = new Set([
  "mesa_admin",
  "mesa_control_admin",
  "mesa_interno",
  "mesa_externo",
  "super_admin",
  "mesa_control",
  "mesa_control_interno",
  "mesa_control_externo",
]);

const MARCADOR_ROLES = new Set([
  "mesa_admin",
  "mesa_control_admin",
  "mesa_interno",
  "mesa_externo",
  "super_admin",
  "mesa_control",
  "mesa_control_interno",
  "mesa_control_externo",
]);

export function canMesaTomarExpedienteRole(role: string | null | undefined): boolean {
  return TAKE_ROLES.has(String(role ?? "").trim());
}

export function canMesaToggleMarcadorRole(role: string | null | undefined): boolean {
  return MARCADOR_ROLES.has(String(role ?? "").trim());
}

export type MesaTomarExpedienteAccion = Readonly<{
  visible: boolean;
  assignedToMe: boolean;
  assignedToOther: boolean;
  assignedLabel: string | null;
}>;

export function resolveMesaTomarExpedienteAccion(params: {
  ops: MesaExpedienteOpsRow | null | undefined;
  currentUserId: string | null | undefined;
  role: string | null | undefined;
  cicloEstado?: string | null;
  submittedToMesa?: boolean;
  assignedDisplayName?: string | null;
}): MesaTomarExpedienteAccion {
  if (!canMesaTomarExpedienteRole(params.role)) {
    return {
      visible: false,
      assignedToMe: false,
      assignedToOther: false,
      assignedLabel: null,
    };
  }
  if (params.cicloEstado != null && params.cicloEstado !== "activo") {
    return {
      visible: false,
      assignedToMe: false,
      assignedToOther: false,
      assignedLabel: null,
    };
  }
  if (params.submittedToMesa === false) {
    return {
      visible: false,
      assignedToMe: false,
      assignedToOther: false,
      assignedLabel: null,
    };
  }

  if (isAssignedToCurrentUser(params.ops, params.currentUserId)) {
    return {
      visible: false,
      assignedToMe: true,
      assignedToOther: false,
      assignedLabel: "Asignado a mí",
    };
  }

  if (!isSinAsignarOps(params.ops) && params.ops?.assignedTo) {
    return {
      visible: false,
      assignedToMe: false,
      assignedToOther: true,
      assignedLabel: params.assignedDisplayName?.trim() || "Asignado",
    };
  }

  return {
    visible: true,
    assignedToMe: false,
    assignedToOther: false,
    assignedLabel: null,
  };
}

export const MESA_TIENE_DATOS_BADGE_LABEL = "📌 Tiene datos";
export const MESA_SIGUIENTE_ETAPA_CONFIRM_PREFIX =
  "El expediente avanzará de";
