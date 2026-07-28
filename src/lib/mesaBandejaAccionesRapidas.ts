/**
 * P119 / P133 — resolución de acciones rápidas en tarjeta de bandeja Mesa.
 * Avances usan `avanzar_etapa_operativa` (gates SQL). Etapas 3/8/9: solo info (asesor agenda/carga).
 * Interna 5→8 canónica P132-acuse. Interna 8→9 solo vía carga Acuse. 9→10 solo vía booking asesor.
 * Interna 11→12: RPC canónica `avanzar_etapa_operativa` transición `11_12`.
 */

import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import type { RetencionOpcion } from "@/domain/expediente-retencion/types";
import { isRetencionPrincipalDocumentTipo } from "@/lib/fileUploadValidation";
import {
  deriveAvanceOperativo2a3View,
  deriveAvanceOperativo4a5View,
  deriveAvanceOperativo5a6View,
  deriveAvanceOperativo6a7View,
  deriveAvanceOperativo7a8View,
  deriveAvanceOperativo10a11View,
  deriveAvanceOperativo11a12View,
  deriveCierreValidacionDocumentalView,
  type AvanceOperativoEtapaView,
} from "@/domain/expedientes/mesa-avance-integracion";
import { formatPasoOperativoLabel } from "@/domain/expedientes/etapa-numeracion-ux";
import {
  isAssignedToCurrentUser,
  isSinAsignarOps,
} from "@/lib/mesaOpsUi";
import type { MesaExpedienteOpsRow } from "@/domain/mesa-ops/types";

/** Anclas existentes / añadidas en detalle Mesa (scroll focus). */
export const MESA_BANDEJA_FOCUS = {
  biometricos: "mesa-agenda",
  firmas: "mesa-agendar-firma",
  acuse: "mesa-retencion",
} as const;

export type MesaBandejaFocusKey = keyof typeof MESA_BANDEJA_FOCUS;

/** Transiciones que ejecutan `avanzar_etapa_operativa` desde bandeja. */
export const MESA_SIGUIENTE_ETAPA_MAP: Readonly<Record<number, number>> = {
  1: 2,
  2: 3,
  4: 5,
  /** P132-acuse: cierre Biometría canónico 5→8 (históricos en 6 siguen con 6→7). */
  5: 8,
  6: 7,
  7: 8,
  10: 11,
  11: 12,
};

/**
 * P119.4: `avanzar_etapa_operativa` admite transición canónica 11→12
 * (migración 108). Roles Mesa + `action_log`; sin movimiento manual libre.
 */
export const MESA_TIENE_RPC_CANONICA_11_A_12 = true;

export type MesaBandejaAccionKind =
  | "avanzar"
  | "navegar_biometricos"
  | "navegar_firma"
  | "navegar_acuse"
  | "info"
  | "etapa_final"
  | "hidden";

export type MesaSiguienteEtapaReasonCode =
  | "faltan_documentos"
  | "falta_cita"
  | "falta_acuse"
  | "rechazado"
  | "cancelado"
  | "no_disponible";

export type MesaSiguienteEtapaAccion = Readonly<{
  kind: MesaBandejaAccionKind;
  visible: boolean;
  enabled: boolean;
  label: string;
  href: string | null;
  usesAvanzarRpc: boolean;
  fromEtapa: number;
  toEtapa: number | null;
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
  /** Rol actor: acciones de agenda solo para Mesa autorizada. */
  role?: string | null;
  expedienteId?: string | null;
  /** P132: fecha mínima de agenda de firma (YYYY-MM-DD). */
  firmaAgendableDesde?: string | null;
}>;

const REASON_LABELS: Readonly<Record<MesaSiguienteEtapaReasonCode, string>> = {
  faltan_documentos: "Falta validar documentos",
  falta_cita: "Falta cita activa",
  falta_acuse: "Falta cargar el Acuse",
  rechazado: "Expediente rechazado",
  cancelado: "Acción no disponible en esta etapa",
  no_disponible: "Acción no disponible en esta etapa",
};

const MESA_AGENDA_ROLES = new Set([
  "mesa_admin",
  "mesa_control_admin",
  "mesa_interno",
  "mesa_externo",
  "super_admin",
  "mesa_control",
  "mesa_control_interno",
  "mesa_control_externo",
]);

export function canMesaAgendaRapidaRole(role: string | null | undefined): boolean {
  return MESA_AGENDA_ROLES.has(String(role ?? "").trim());
}

export function buildMesaExpedienteFocusHref(
  expedienteId: string,
  focusKey: MesaBandejaFocusKey,
): string {
  const anchor = MESA_BANDEJA_FOCUS[focusKey];
  return `/mesa-control/${expedienteId}?focus=${encodeURIComponent(anchor)}#${anchor}`;
}

export function hasAcusePrincipalCargado(
  archivos: readonly ExpedienteArchivoResumen[] | null | undefined,
): boolean {
  if (!archivos?.length) return false;
  return archivos.some((row) => {
    if (!isRetencionPrincipalDocumentTipo(row.tipo_documento)) return false;
    if (!row.id) return false;
    return row.estatus_revision !== "faltante";
  });
}

export function mapBloqueosToSiguienteEtapaReason(
  bloqueos: readonly string[],
): MesaSiguienteEtapaReasonCode {
  const text = bloqueos.join(" ").toLowerCase();
  if (text.includes("acuse") && text.includes("falta")) {
    return "falta_acuse";
  }
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

function emptyHidden(from: number, to: number | null = null): MesaSiguienteEtapaAccion {
  return {
    kind: "hidden",
    visible: false,
    enabled: false,
    label: "",
    href: null,
    usesAvanzarRpc: false,
    fromEtapa: from,
    toEtapa: to,
    fromLabel: formatPasoOperativoLabel(from),
    toLabel: to != null ? formatPasoOperativoLabel(to) : "",
    reasonCode: null,
    reasonShort: null,
    bloqueos: [],
  };
}

function labelForAvanzar(from: number, to: number): string {
  if (from === 4 && to === 5) return "Pasar a Biometría resultado";
  if (from === 5 && to === 8) return "Pasar a Acuse";
  if (from === 10 && to === 11) return "Marcar firma como completada";
  if (from === 11 && to === 12) return "Pasar a Pago a ConCasa";
  if (from === 6 && to === 7) return "Aceptar y avanzar a Notificación";
  if (from === 7 && to === 8) return "Aceptar y avanzar a Acuse / Aviso de retención";
  return "Siguiente etapa";
}

/** Formatea YYYY-MM-DD (o ISO) a DD/MM/YYYY para copy Mesa. */
export function formatMesaFirmaAgendableDesdeLabel(
  raw: string | null | undefined,
): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const ymd = s.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function todayYmdMonterrey(nowMs: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Monterrey",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}

function infoAccion(
  from: number,
  label: string,
  to: number | null = null,
): MesaSiguienteEtapaAccion {
  return {
    kind: "info",
    visible: true,
    enabled: false,
    label,
    href: null,
    usesAvanzarRpc: false,
    fromEtapa: from,
    toEtapa: to,
    fromLabel: formatPasoOperativoLabel(from),
    toLabel: to != null ? formatPasoOperativoLabel(to) : "",
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
    label?: string;
  },
): MesaSiguienteEtapaAccion {
  const visible = override?.visible ?? view.mostrar;
  if (!visible) return emptyHidden(from, to);
  const enabled = override?.enabled ?? view.puedeAvanzar;
  const reasonCode = enabled
    ? null
    : (override?.reasonCode ?? mapBloqueosToSiguienteEtapaReason(view.bloqueos));
  return {
    kind: "avanzar",
    visible: true,
    enabled,
    label: override?.label ?? labelForAvanzar(from, to),
    href: null,
    usesAvanzarRpc: true,
    fromEtapa: from,
    toEtapa: to,
    fromLabel: formatPasoOperativoLabel(from),
    toLabel: formatPasoOperativoLabel(to),
    reasonCode,
    reasonShort: reasonCode ? REASON_LABELS[reasonCode] : null,
    bloqueos: view.bloqueos,
  };
}

function cicloORechazoGate(
  ctx: MesaSiguienteEtapaContext,
  etapa: number,
  to: number | null,
  kind: MesaBandejaAccionKind,
  label: string,
): MesaSiguienteEtapaAccion | null {
  if (ctx.cicloEstado != null && ctx.cicloEstado !== "activo") {
    return {
      kind,
      visible: true,
      enabled: false,
      label,
      href: null,
      usesAvanzarRpc: false,
      fromEtapa: etapa,
      toEtapa: to,
      fromLabel: formatPasoOperativoLabel(etapa),
      toLabel: to != null ? formatPasoOperativoLabel(to) : "",
      reasonCode: "cancelado",
      reasonShort: REASON_LABELS.cancelado,
      bloqueos: ["Expediente cancelado o cerrado."],
    };
  }
  if (ctx.subestado === "rechazado") {
    return {
      kind,
      visible: true,
      enabled: false,
      label,
      href: null,
      usesAvanzarRpc: false,
      fromEtapa: etapa,
      toEtapa: to,
      fromLabel: formatPasoOperativoLabel(etapa),
      toLabel: to != null ? formatPasoOperativoLabel(to) : "",
      reasonCode: "rechazado",
      reasonShort: REASON_LABELS.rechazado,
      bloqueos: ["Expediente rechazado."],
    };
  }
  return null;
}

/**
 * Resuelve la acción primaria de la tarjeta por etapa interna.
 */
export function resolveMesaSiguienteEtapaAccion(
  ctx: MesaSiguienteEtapaContext,
): MesaSiguienteEtapaAccion {
  const etapa = ctx.etapaActual ?? null;
  if (etapa == null || !Number.isFinite(etapa)) {
    return emptyHidden(0, 0);
  }

  const archivos = ctx.archivosResumen ?? [];

  // —— 12: indicador final ——
  if (etapa === 12) {
    return {
      kind: "etapa_final",
      visible: true,
      enabled: false,
      label: "Etapa final",
      href: null,
      usesAvanzarRpc: false,
      fromEtapa: 12,
      toEtapa: null,
      fromLabel: formatPasoOperativoLabel(12),
      toLabel: "",
      reasonCode: null,
      reasonShort: null,
      bloqueos: [],
    };
  }

  // —— 3: asesor agenda biométricos; Mesa solo informa (sin avance ni booking) ——
  if (etapa === 3) {
    return infoAccion(3, "Esperando agenda de biométricos del asesor", null);
  }

  // —— 9: asesor agenda firma; Mesa informa (sin botón Agendar firma ni 9→10) ——
  if (etapa === 9) {
    const fechaLabel = formatMesaFirmaAgendableDesdeLabel(ctx.firmaAgendableDesde);
    const today = todayYmdMonterrey(ctx.nowMs);
    const minYmd = String(ctx.firmaAgendableDesde ?? "").trim().slice(0, 10);
    if (fechaLabel && minYmd && minYmd > today) {
      return infoAccion(9, `Firma disponible desde ${fechaLabel}`, 10);
    }
    return infoAccion(9, "Esperando agenda del asesor", 10);
  }

  // —— 8: Acuse solo vía carga del asesor (8→9); Mesa informa ——
  if (etapa === 8) {
    return infoAccion(8, "Esperando carga de Acuse por el asesor", 9);
  }

  const to = MESA_SIGUIENTE_ETAPA_MAP[etapa];
  if (to == null) return emptyHidden(etapa, etapa);

  const gateAvanzar = cicloORechazoGate(
    ctx,
    etapa,
    to,
    "avanzar",
    labelForAvanzar(etapa, to),
  );
  if (gateAvanzar) return gateAvanzar;

  const base = {
    submittedToMesa: Boolean(ctx.submittedToMesa),
    cicloEstado: ctx.cicloEstado ?? "activo",
    etapaActual: etapa,
    subestado: ctx.subestado ?? null,
  };

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
      { label: "Pasar a Biometría resultado" },
    );
  }

  if (etapa === 5) {
    return fromView(
      5,
      8,
      deriveAvanceOperativo5a6View({
        ...base,
        fechaCita: ctx.fechaCita,
        hasActiveBiometricBooking: Boolean(ctx.hasActiveBiometricBooking),
        nowMs: ctx.nowMs,
      }),
      { label: "Pasar a Acuse" },
    );
  }

  if (etapa === 6) return fromView(6, 7, deriveAvanceOperativo6a7View(base));
  if (etapa === 7) return fromView(7, 8, deriveAvanceOperativo7a8View(base));

  if (etapa === 10) {
    return fromView(
      10,
      11,
      deriveAvanceOperativo10a11View({
        ...base,
        fechaCita: ctx.fechaCita,
        hasActiveFirmasBooking: Boolean(ctx.hasActiveFirmasBooking),
      }),
      { label: "Marcar firma como completada" },
    );
  }

  if (etapa === 11) {
    if (!MESA_TIENE_RPC_CANONICA_11_A_12) return emptyHidden(11, 12);
    return fromView(11, 12, deriveAvanceOperativo11a12View(base), {
      label: "Pasar a Pago a ConCasa",
    });
  }

  return emptyHidden(etapa, to);
}

/**
 * P133 — alias canónico: misma lógica que `resolveMesaSiguienteEtapaAccion`.
 * Separa estado (fromLabel) de acción (label / toEtapa).
 */
export type MesaQuickAction = Readonly<{
  actionId: string;
  label: string;
  targetStage: number | null;
  enabled: boolean;
  disabledReason: string | null;
  requiresBooking: boolean;
  requiresDocument: boolean;
  requiresConfirmation: boolean;
  /** Acción resuelta completa (UI bandeja). */
  accion: MesaSiguienteEtapaAccion;
}>;

export function resolveMesaQuickAction(
  ctx: MesaSiguienteEtapaContext,
): MesaQuickAction {
  const accion = resolveMesaSiguienteEtapaAccion(ctx);
  const requiresBooking =
    accion.fromEtapa === 4 ||
    accion.fromEtapa === 5 ||
    accion.fromEtapa === 10;
  const requiresDocument = accion.fromEtapa === 1;
  return {
    actionId: `${accion.kind}:${accion.fromEtapa}->${accion.toEtapa ?? "none"}`,
    label: accion.label,
    targetStage: accion.toEtapa,
    enabled: accion.enabled,
    disabledReason: accion.reasonShort,
    requiresBooking,
    requiresDocument,
    requiresConfirmation: accion.kind === "avanzar" && accion.usesAvanzarRpc,
    accion,
  };
}

const TAKE_ROLES = MESA_AGENDA_ROLES;
const MARCADOR_ROLES = MESA_AGENDA_ROLES;

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

export const MESA_TIENE_DATOS_BADGE_LABEL = "📌 Tiene documentos";
export const MESA_SIGUIENTE_ETAPA_CONFIRM_PREFIX =
  "El expediente avanzará de";

/** Confirmación canónica bandeja/detalle para 11→12 (P119.4). */
export const MESA_AVANZAR_11_12_CONFIRM =
  "El expediente pasará a la etapa final Pago a ConCasa.";
