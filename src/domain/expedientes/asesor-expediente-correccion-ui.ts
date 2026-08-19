/**
 * P197-B3 — presentación del episodio de corrección en detalle asesor.
 * Clasificación: solo `estado_efectivo` (SQL). Motivos/secciones = metadatos reales.
 */
import { getAsesorInboxEstadoEfectivoPresentation } from "./asesor-inbox-estado-efectivo";

export const ASESOR_CORRECCION_FOCUS_PARAM = "focus";
export const ASESOR_CORRECCION_FOCUS_VALUE = "correccion";
export const ASESOR_CORRECCION_PANEL_ID = "asesor-correccion-ahora";
export const ASESOR_SECCION_DG_ID = "asesor-seccion-dg";
export const ASESOR_SECCION_DOCS_ID = "asesor-seccion-docs";
export const ASESOR_SECCION_RETENCION_ID = "asesor-seccion-retencion";
export const ASESOR_SECCION_OPERATIVO_ID = "asesor-seccion-operativo";

export type AsesorCorreccionActionKind =
  | "dg"
  | "documento"
  | "retencion"
  | "operativo";

export type AsesorCorreccionActionItem = {
  kind: AsesorCorreccionActionKind;
  label: string;
  detail: string | null;
  focusId: string;
  ctaLabel: string;
};

export type AsesorExpedienteCorreccionView = {
  estadoEfectivo: string;
  label: string;
  showNecesitaPanel: boolean;
  showEnviadaPanel: boolean;
  showRechazoOperativoBanner: boolean;
  showCanceladoDominante: boolean;
  actions: AsesorCorreccionActionItem[];
};

export function asesorExpedienteDetalleHref(
  expedienteId: string,
  estadoEfectivo?: string | null,
): string {
  const base = `/asesor/expediente/${expedienteId}`;
  if (estadoEfectivo === "correccion_requerida") {
    return `${base}?${ASESOR_CORRECCION_FOCUS_PARAM}=${ASESOR_CORRECCION_FOCUS_VALUE}`;
  }
  return base;
}

export function notificationKindMatchesEstadoEfectivo(
  estadoEfectivo: string,
  kind: string | null | undefined,
): boolean {
  if (!kind) return true;
  if (estadoEfectivo === "correccion_requerida") {
    return kind !== "correccion_enviada" && kind !== "rechazado_mesa";
  }
  if (estadoEfectivo === "correccion_enviada") {
    return kind !== "correccion_requerida" && kind !== "rechazado_mesa";
  }
  if (estadoEfectivo === "en_tramite") {
    return (
      kind !== "correccion_requerida" &&
      kind !== "correccion_enviada" &&
      kind !== "rechazado_mesa"
    );
  }
  if (estadoEfectivo === "rechazado_mesa") {
    return kind !== "correccion_enviada" && kind !== "correccion_requerida";
  }
  if (estadoEfectivo === "cancelado") {
    return kind === "cancelado";
  }
  return true;
}

export function inboxDetalleNotificacionConsistentes(params: {
  inboxEstado: string;
  detalleEstado: string;
  notificationKind?: string | null;
}): boolean {
  if (params.inboxEstado !== params.detalleEstado) return false;
  return notificationKindMatchesEstadoEfectivo(
    params.detalleEstado,
    params.notificationKind,
  );
}

function isRetencionTipo(tipo: string): boolean {
  return tipo.startsWith("retencion_");
}

export function buildAsesorExpedienteCorreccionView(input: {
  estadoEfectivo: string | null | undefined;
  clienteDatosEstado?: string | null;
  clienteDatosComentario?: string | null;
  documentosRechazados?: ReadonlyArray<{
    tipo: string;
    label?: string | null;
    comentario?: string | null;
  }>;
  retencionCorreccionRequerida?: boolean;
  rechazoOperativoMotivo?: string | null;
  rechazoOperativoComentario?: string | null;
}): AsesorExpedienteCorreccionView {
  const estado = (input.estadoEfectivo ?? "").trim() || "en_tramite";
  const pres = getAsesorInboxEstadoEfectivoPresentation(estado);
  const actions: AsesorCorreccionActionItem[] = [];

  if (estado === "correccion_requerida") {
    if (input.clienteDatosEstado === "rechazado") {
      actions.push({
        kind: "dg",
        label: "Datos generales",
        detail: input.clienteDatosComentario?.trim() || null,
        focusId: ASESOR_SECCION_DG_ID,
        ctaLabel: "Corregir datos",
      });
    }
    const docs = input.documentosRechazados ?? [];
    let hasRetencionDoc = false;
    for (const d of docs) {
      const ret = isRetencionTipo(d.tipo);
      if (ret) hasRetencionDoc = true;
      actions.push({
        kind: ret ? "retencion" : "documento",
        label: d.label?.trim() || d.tipo,
        detail: d.comentario?.trim() || null,
        focusId: ret ? ASESOR_SECCION_RETENCION_ID : ASESOR_SECCION_DOCS_ID,
        ctaLabel: ret ? "Corregir retención" : "Corregir documento",
      });
    }
    if (input.retencionCorreccionRequerida && !hasRetencionDoc) {
      actions.push({
        kind: "retencion",
        label: "Acuse / retención",
        detail: null,
        focusId: ASESOR_SECCION_RETENCION_ID,
        ctaLabel: "Corregir retención",
      });
    }
    const mot = input.rechazoOperativoMotivo?.trim();
    if (mot && actions.length === 0) {
      actions.push({
        kind: "operativo",
        label: "Rechazo operativo",
        detail: input.rechazoOperativoComentario?.trim() || mot,
        focusId: ASESOR_SECCION_OPERATIVO_ID,
        ctaLabel: "Ver rechazo",
      });
    }
  }

  return {
    estadoEfectivo: estado,
    label: pres.label,
    showNecesitaPanel: estado === "correccion_requerida",
    showEnviadaPanel: estado === "correccion_enviada",
    showRechazoOperativoBanner: estado === "rechazado_mesa",
    showCanceladoDominante: estado === "cancelado",
    actions,
  };
}
