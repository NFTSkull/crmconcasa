/**
 * P209 — copy causal compartido inbox + detalle asesor.
 * Espejo SQL: asesor_inbox_format_correccion_explicacion.
 */

export const ASESOR_CORRECCION_EXPLICACION_FALLBACK =
  "Mesa tiene una corrección pendiente. Abre el expediente para revisar el detalle.";

/** Labels humanos alineados con asesor_cambio_doc_label (SQL) y asesor-pendientes. */
export const ASESOR_CORRECCION_DOC_LABEL: Readonly<Record<string, string>> = {
  ine: "INE",
  estado_cuenta: "Estado de cuenta",
  nss: "NSS",
  direccion: "Comprobante de domicilio",
  cliente_ine_frente: "INE frente",
  cliente_ine_reverso: "INE reverso",
  cliente_comprobante_domicilio: "Comprobante de domicilio",
  cliente_estado_cuenta: "Estado de cuenta",
  cliente_acta_nacimiento: "Acta de nacimiento",
  cliente_constancia_sat: "Constancia SAT",
  cliente_semanas_cotizadas: "Semanas cotizadas",
  cliente_historial_laboral: "Historial laboral",
  cliente_carta_empresa: "Carta de la empresa",
  cliente_acta_nacimiento_digital: "Acta de nacimiento digital",
  cliente_notificacion_apodaca: "Notificación",
  cliente_pagare: "Pagaré",
  cliente_notificacion: "Notificación",
  cliente_solicitud: "Solicitud",
  retencion_acuse_con_sello: "Acuse con sello",
  retencion_aviso_retencion: "Aviso de retención",
  retencion_ine_frente: "Retención INE frente",
  retencion_ine_reverso: "Retención INE reverso",
  retencion_carta_sin_sello: "Carta sin sello",
  asesor_ine_frente: "Asesor INE frente",
  asesor_ine_reverso: "Asesor INE reverso",
  asesor_estado_cuenta: "Asesor estado de cuenta",
  asesor_recibo_luz: "Asesor recibo de luz",
};

export function labelAsesorCorreccionDocumento(tipo: string): string {
  const key = String(tipo ?? "").trim().toLowerCase();
  if (!key) return "Documento";
  return ASESOR_CORRECCION_DOC_LABEL[key] ?? tipo;
}

export function formatAsesorCorreccionExplicacion(
  labels: readonly string[],
): string {
  const items = labels
    .map((l) => String(l ?? "").trim())
    .filter((l) => l.length > 0);
  if (items.length === 0) return ASESOR_CORRECCION_EXPLICACION_FALLBACK;
  if (items.length === 1) {
    return `Mesa solicita corregir: ${items[0]}.`;
  }
  if (items.length === 2) {
    return `Mesa solicita corregir 2 elementos: ${items[0]} e ${items[1]}.`;
  }
  const head = items.slice(0, -1).join(", ");
  return `Mesa solicita corregir ${items.length} elementos: ${head} y ${items[items.length - 1]}.`;
}

export function resolveAsesorCorreccionExplicacion(params: {
  estadoEfectivo?: string | null;
  correccionExplicacion?: string | null;
  labels?: readonly string[] | null;
}): string | null {
  const estado = (params.estadoEfectivo ?? "").trim();
  if (estado !== "correccion_requerida") return null;

  const fromRpc = (params.correccionExplicacion ?? "").trim();
  if (fromRpc) return fromRpc;

  if (params.labels && params.labels.length > 0) {
    return formatAsesorCorreccionExplicacion(params.labels);
  }

  return ASESOR_CORRECCION_EXPLICACION_FALLBACK;
}
