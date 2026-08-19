/**
 * Presentación de fila inbox `/asesor`.
 * Estado actual = `estado_efectivo` (P197). P184 overlay visual etapa 12.
 * No recalcula causalidad P196 ni membresía de chips.
 */
import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos";
import { subestadoOperativoLabel } from "@/lib/subestadoOperativoUi";
import { getAsesorInboxEstadoEfectivoPresentation } from "./asesor-inbox-estado-efectivo";
import type { PagoConcasaResultado } from "./pago-concasa-resultado";

const RESULTADO_PAGADO_CLASS =
  "bg-green-100 text-green-800 border border-green-200";
const ESTATUS_PAGADO_CLASS =
  "text-[10px] font-medium text-green-800";
const ESTATUS_NO_PAGO_CLASS =
  "text-[10px] font-medium text-amber-900";
const ESTATUS_SECUNDARIO_CLASS =
  "text-[10px] font-normal text-gray-500";

export type AsesorInboxFilaBadge = { label: string; className: string };

function isEtapaPagoConcasa(etapaActual?: number | null): boolean {
  return Number(etapaActual) === 12;
}

function puedeOverlayPagoConcasa(estadoEfectivo: string | null | undefined): boolean {
  const e = (estadoEfectivo ?? "").trim();
  return e === "en_tramite" || e === "aprobado_editor" || e === "";
}

/** Chip principal: solo `estado_efectivo` (+ overlay P184 en etapa 12). */
export function asesorEstadoActualFilaBadge(
  estadoEfectivo: string | null | undefined,
  etapaActual?: number | null,
  pagoConcasaResultado?: PagoConcasaResultado | null,
): AsesorInboxFilaBadge {
  if (
    puedeOverlayPagoConcasa(estadoEfectivo) &&
    isEtapaPagoConcasa(etapaActual) &&
    pagoConcasaResultado === "pagado"
  ) {
    return { label: "Completado", className: RESULTADO_PAGADO_CLASS };
  }
  if (
    puedeOverlayPagoConcasa(estadoEfectivo) &&
    isEtapaPagoConcasa(etapaActual) &&
    pagoConcasaResultado === "no_pagado"
  ) {
    return {
      label: "Finalizado",
      className: "bg-slate-100 text-slate-800 border border-slate-300",
    };
  }
  const pres = getAsesorInboxEstadoEfectivoPresentation(estadoEfectivo);
  return { label: pres.label, className: pres.className };
}

/** @deprecated alias — el primer argumento es estado_efectivo, no resultado_real. */
export function asesorResultadoFilaBadge(
  estadoEfectivo: string | null | undefined,
  etapaActual?: number | null,
  pagoConcasaResultado?: PagoConcasaResultado | null,
): AsesorInboxFilaBadge {
  return asesorEstadoActualFilaBadge(
    estadoEfectivo,
    etapaActual,
    pagoConcasaResultado,
  );
}

/**
 * Estatus operativo: secundario. No compite con Estado actual.
 * Oculta `subestado=rechazado` (histórico o duplicado del episodio P197).
 */
export function asesorEstatusOperativoFilaBadge(
  subestado: string | null | undefined,
  estadoEfectivo?: string | null,
  cicloEstado?: string | null,
  etapaActual?: number | null,
  pagoConcasaResultado?: PagoConcasaResultado | null,
): AsesorInboxFilaBadge | null {
  const estado = (estadoEfectivo ?? "").trim();

  if (estado === "cancelado" || cicloEstado === "cancelado") {
    return null;
  }

  if (puedeOverlayPagoConcasa(estado) && isEtapaPagoConcasa(etapaActual)) {
    if (pagoConcasaResultado === "pagado") {
      return { label: "Pagado", className: ESTATUS_PAGADO_CLASS };
    }
    if (pagoConcasaResultado === "no_pagado") {
      return { label: "No pagó", className: ESTATUS_NO_PAGO_CLASS };
    }
  }

  if (subestado === "rechazado") {
    return null;
  }

  if (estado === "rechazado_mesa") {
    return null;
  }

  const label = subestadoOperativoLabel(subestado);
  if (!label || label === "—") return null;
  return { label, className: ESTATUS_SECUNDARIO_CLASS };
}

export function asesorDocumentacionFilaBadge(
  estadoDocumentacionLabel: string,
  estadoDocumentacionClassName: string,
  resumenCorreccion?: CategoriaResumenDocumental,
): AsesorInboxFilaBadge {
  if (resumenCorreccion === "correccion_requerida") {
    return {
      label: "Necesita corrección",
      className: "text-[10px] font-medium text-amber-900/80 sm:text-xs",
    };
  }
  if (resumenCorreccion === "correccion_enviada") {
    return {
      label: "Corrección enviada",
      className: "text-[10px] font-medium text-emerald-700 sm:text-xs",
    };
  }
  return {
    label: estadoDocumentacionLabel,
    className: `${estadoDocumentacionClassName} text-[10px] sm:text-xs`,
  };
}

export function asesorInboxFilaEstadoLabels(params: {
  estadoEfectivo: string;
  resultadoReal?: string;
  resumenCorreccion?: CategoriaResumenDocumental;
  etapaActual?: number | null;
  pagoConcasaResultado?: PagoConcasaResultado | null;
  subestado?: string | null;
  cicloEstado?: string | null;
  etapaDisplay: string;
}): {
  estadoActual: string;
  documentacion: string;
  estatus: string | null;
  etapa: string;
} {
  const estadoActual = asesorEstadoActualFilaBadge(
    params.estadoEfectivo,
    params.etapaActual,
    params.pagoConcasaResultado,
  );
  const estatus = asesorEstatusOperativoFilaBadge(
    params.subestado,
    params.estadoEfectivo,
    params.cicloEstado,
    params.etapaActual,
    params.pagoConcasaResultado,
  );
  const documentacion = asesorDocumentacionFilaBadge(
    "—",
    "text-xs text-gray-400",
    params.resumenCorreccion,
  );
  return {
    estadoActual: estadoActual.label,
    documentacion: documentacion.label,
    estatus: estatus?.label ?? null,
    etapa: params.etapaDisplay,
  };
}
