/**
 * Presentación del chip inbox asesor.
 * Autoridad de clasificación = SQL `asesor_inbox_estado_efectivo` (P201 → P198).
 * Este módulo no reimplementa P196/P198 ni causalidad de lotes.
 */
export const ASESOR_INBOX_ESTADOS_EFECTIVOS = [
  "cancelado",
  "correccion_requerida",
  "correccion_enviada",
  "rechazado_mesa",
  "en_tramite",
  "no_cumple_editor",
  "aprobado_editor",
  "pendiente_editor",
] as const;

export type AsesorInboxEstadoEfectivo =
  (typeof ASESOR_INBOX_ESTADOS_EFECTIVOS)[number];

export type AsesorInboxEstadoEfectivoPresentation = {
  label: string;
  semanticVariant:
    | "cancelado"
    | "correccion_requerida"
    | "correccion_enviada"
    | "rechazado_mesa"
    | "en_tramite"
    | "editor"
    | "neutral";
  className: string;
};

const PRESENTATION: Record<string, AsesorInboxEstadoEfectivoPresentation> = {
  cancelado: {
    label: "Cancelado",
    semanticVariant: "cancelado",
    className: "bg-slate-200 text-slate-900 border border-slate-400",
  },
  correccion_requerida: {
    label: "Necesita corrección",
    semanticVariant: "correccion_requerida",
    className: "bg-amber-100 text-amber-900 border border-amber-300",
  },
  correccion_enviada: {
    label: "Corrección enviada",
    semanticVariant: "correccion_enviada",
    className: "bg-sky-100 text-sky-800 border border-sky-200",
  },
  rechazado_mesa: {
    label: "Rechazado por Mesa",
    semanticVariant: "rechazado_mesa",
    className: "bg-red-100 text-red-900 border border-red-300 font-semibold",
  },
  en_tramite: {
    label: "En trámite",
    semanticVariant: "en_tramite",
    className: "bg-blue-100 text-blue-800 border border-blue-200",
  },
  no_cumple_editor: {
    label: "No cumple (editor)",
    semanticVariant: "editor",
    className: "bg-red-100 text-red-800 border border-red-200",
  },
  aprobado_editor: {
    label: "Aprobado (editor)",
    semanticVariant: "editor",
    className: "bg-green-100 text-green-800 border border-green-200",
  },
  pendiente_editor: {
    label: "Pendiente (editor)",
    semanticVariant: "editor",
    className: "bg-amber-100 text-amber-800 border border-amber-200",
  },
};

/** Solo copy/color. No mira categoria_correccion, resultado_real ni subestado. */
export function getAsesorInboxEstadoEfectivoPresentation(
  estadoEfectivo: string | null | undefined,
): AsesorInboxEstadoEfectivoPresentation {
  const key = (estadoEfectivo ?? "").trim();
  if (key && PRESENTATION[key]) return PRESENTATION[key]!;
  if (!key) {
    return {
      label: "—",
      semanticVariant: "neutral",
      className: "bg-gray-100 text-gray-500 border border-gray-200",
    };
  }
  return {
    label: key,
    semanticVariant: "neutral",
    className: "bg-gray-100 text-gray-700 border border-gray-200",
  };
}

/**
 * Aproximación mock del helper SQL (solo modo mock).
 * P204-A: WAITING + RECHAZO_OPERATIVO_CON_CORRECCION → rechazado_mesa.
 * P201: no reabre Necesita solo por categoria_correccion si el episodio
 * ya está respondido; en mock no hay P198, así que categoria enviada
 * sigue ganando sobre rechazo de columna, y requerida solo si no hay enviada.
 * La UI de producción no debe llamar esto: usa `item.estado_efectivo`.
 */
export function deriveAsesorInboxEstadoEfectivoMock(input: {
  resultadoReal: string;
  categoriaCorreccion: string | null | undefined;
  /** Opcional: espejo P198 cuando el mock lo conoce. */
  mesaCambioEstado?:
    | "CORRECTION_PENDING_REVIEW"
    | "WAITING_ADVISOR"
    | "CLOSED"
    | "ADVISOR_UPDATE_PENDING_REVIEW"
    | null;
  /** P198 request_type (p. ej. RECHAZO_OPERATIVO_CON_CORRECCION). */
  mesaCambioRequestType?: string | null;
}): AsesorInboxEstadoEfectivo | string {
  if (input.resultadoReal === "cancelado") return "cancelado";
  if (input.mesaCambioEstado === "CORRECTION_PENDING_REVIEW") {
    return "correccion_enviada";
  }
  if (
    input.mesaCambioEstado === "WAITING_ADVISOR" &&
    input.mesaCambioRequestType === "RECHAZO_OPERATIVO_CON_CORRECCION"
  ) {
    return "rechazado_mesa";
  }
  if (input.mesaCambioEstado === "WAITING_ADVISOR") {
    return "correccion_requerida";
  }
  if (input.categoriaCorreccion === "correccion_enviada") {
    return "correccion_enviada";
  }
  if (input.categoriaCorreccion === "correccion_requerida") {
    return "correccion_requerida";
  }
  if (input.resultadoReal === "rechazado_mesa") return "rechazado_mesa";
  return input.resultadoReal;
}
