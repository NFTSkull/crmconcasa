/**
 * P184 — presentación de fila inbox `/asesor` (etapa 12 Pago ConCasa).
 * Override visual only. No cambia resultado_real SQL ni deriveResultadoRealExpediente.
 */
import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos";
import {
  subestadoOperativoBadgeClass,
  subestadoOperativoLabel,
} from "@/lib/subestadoOperativoUi";
import type { ResultadoRealExpediente } from "./mock.repo";
import type { PagoConcasaResultado } from "./pago-concasa-resultado";

const CORRECCION_REQUERIDA_BADGE_CLASS =
  "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-300";

const RESULTADO_PAGADO_CLASS =
  "bg-green-100 text-green-800 border border-green-200";
const ESTATUS_PAGADO_CLASS =
  "inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 border border-green-200";
const RESULTADO_FINALIZADO_CLASS =
  "bg-slate-100 text-slate-800 border border-slate-300";
const ESTATUS_NO_PAGO_CLASS =
  "inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-900 border border-amber-300";

export type AsesorInboxFilaBadge = { label: string; className: string };

function isEtapaPagoConcasa(etapaActual?: number | null): boolean {
  return Number(etapaActual) === 12;
}

export function asesorResultadoFilaBadge(
  resultadoReal: ResultadoRealExpediente,
  resumenCorreccion?: CategoriaResumenDocumental,
  etapaActual?: number | null,
  pagoConcasaResultado?: PagoConcasaResultado | null,
): AsesorInboxFilaBadge {
  if (resultadoReal === "cancelado") {
    return {
      label: "Cancelado",
      className: "bg-slate-200 text-slate-900 border border-slate-400",
    };
  }
  if (resultadoReal === "rechazado_mesa") {
    return {
      label: "Rechazado (mesa)",
      className: "bg-red-100 text-red-800 border border-red-200",
    };
  }
  if (isEtapaPagoConcasa(etapaActual) && pagoConcasaResultado === "pagado") {
    return { label: "Completado", className: RESULTADO_PAGADO_CLASS };
  }
  if (isEtapaPagoConcasa(etapaActual) && pagoConcasaResultado === "no_pagado") {
    return { label: "Finalizado", className: RESULTADO_FINALIZADO_CLASS };
  }
  if (resumenCorreccion === "correccion_requerida") {
    return {
      label: "Necesita corrección",
      className: "bg-amber-100 text-amber-900 border border-amber-300",
    };
  }
  if (resumenCorreccion === "correccion_enviada") {
    return {
      label: "Corrección enviada",
      className: "bg-sky-100 text-sky-800 border border-sky-200",
    };
  }
  switch (resultadoReal) {
    case "en_tramite":
      return {
        label: "En trámite",
        className: "bg-blue-100 text-blue-800 border border-blue-200",
      };
    case "no_cumple_editor":
      return {
        label: "No cumple (editor)",
        className: "bg-red-100 text-red-800 border border-red-200",
      };
    case "aprobado_editor":
      return {
        label: "Aprobado (editor)",
        className: "bg-green-100 text-green-800 border border-green-200",
      };
    case "pendiente_editor":
    default:
      return {
        label: "Pendiente (editor)",
        className: "bg-amber-100 text-amber-800 border border-amber-200",
      };
  }
}

export function asesorEstatusOperativoFilaBadge(
  subestado: string | null | undefined,
  resumenCorreccion?: CategoriaResumenDocumental,
  cicloEstado?: string | null,
  etapaActual?: number | null,
  pagoConcasaResultado?: PagoConcasaResultado | null,
): AsesorInboxFilaBadge {
  if (cicloEstado === "cancelado") {
    return {
      label: "Cancelado",
      className:
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-slate-200 text-slate-900 ring-1 ring-slate-400",
    };
  }
  if (subestado === "rechazado") {
    return {
      label: subestadoOperativoLabel(subestado),
      className: `inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${subestadoOperativoBadgeClass(subestado)}`,
    };
  }
  if (isEtapaPagoConcasa(etapaActual) && pagoConcasaResultado === "pagado") {
    return { label: "Pagado", className: ESTATUS_PAGADO_CLASS };
  }
  if (isEtapaPagoConcasa(etapaActual) && pagoConcasaResultado === "no_pagado") {
    return { label: "No pagó", className: ESTATUS_NO_PAGO_CLASS };
  }
  if (resumenCorreccion === "correccion_requerida") {
    return { label: "Necesita corrección", className: CORRECCION_REQUERIDA_BADGE_CLASS };
  }
  if (resumenCorreccion === "correccion_enviada") {
    return {
      label: "Corrección enviada",
      className:
        "inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200",
    };
  }
  return {
    label: subestadoOperativoLabel(subestado),
    className: `inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${subestadoOperativoBadgeClass(subestado)}`,
  };
}

/** Simula labels de las 3 columnas de estado para un fixture de fila. */
export function asesorInboxFilaEstadoLabels(params: {
  resultadoReal: ResultadoRealExpediente;
  resumenCorreccion?: CategoriaResumenDocumental;
  etapaActual?: number | null;
  pagoConcasaResultado?: PagoConcasaResultado | null;
  subestado?: string | null;
  cicloEstado?: string | null;
  etapaDisplay: string;
}): { resultado: string; estatus: string; etapa: string } {
  const resultado = asesorResultadoFilaBadge(
    params.resultadoReal,
    params.resumenCorreccion,
    params.etapaActual,
    params.pagoConcasaResultado,
  );
  const estatus = asesorEstatusOperativoFilaBadge(
    params.subestado,
    params.resumenCorreccion,
    params.cicloEstado,
    params.etapaActual,
    params.pagoConcasaResultado,
  );
  return {
    resultado: resultado.label,
    estatus: estatus.label,
    etapa: params.etapaDisplay,
  };
}
