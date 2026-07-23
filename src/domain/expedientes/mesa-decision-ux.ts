import {
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  integrationDocsResumenFromArchivoResumen,
} from "@/domain/expediente-archivos/integration-docs-completos";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";

export type MesaAvanceOperativoCopy = {
  titulo?: string;
  descripcion: string;
  etiquetaBoton: string;
  mensajeConfirmacion: string;
  /** Etapas sin rechazo documental directo (avance operativo puro). */
  mostrarAvisoSinRechazo?: boolean;
};

export const MESA_DECISION_TITULO_AVANCE = "Decisión Mesa";

export const MESA_SOLICITAR_CORRECCION_LABEL = "Solicitar corrección";

export const MESA_AVISO_SIN_RECHAZO_DIRECTO =
  "Esta etapa no tiene rechazo directo. Solo puede avanzar cuando cumpla los requisitos.";

export const MESA_ETAPA_FIRMA_P3Q_NOTA =
  "Esta etapa queda pendiente de resultado de firma. La acción «Firma realizada» se implementará en P3Q.";

export const MESA_CIERRE_INTEGRACION_COPY = {
  titulo: "Decisión Mesa — Integración",
  descripcion:
    "Revisa datos generales y documentos obligatorios. Valida o solicita corrección antes de aceptar el avance a Registro.",
  etiquetaBoton: "Aceptar integración y avanzar a Registro",
  mensajeConfirmacion:
    "¿Confirmas aceptar la integración y avanzar este expediente a etapa 2: Registro?",
} as const;

export const MESA_AVANCE_OPERATIVO_2A3_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "El expediente está en Registro (etapa 2). Confirma el avance a Listo cita biométricos (etapa 3).",
  etiquetaBoton: "Aceptar y avanzar a Listo cita biométricos",
  mensajeConfirmacion:
    "¿Confirmas aceptar y avanzar este expediente a etapa 3: Listo cita biométricos?",
  mostrarAvisoSinRechazo: true,
};

export const MESA_AVANCE_OPERATIVO_3A4_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "Deprecado: el flujo nuevo agenda biométricos en etapa 3 y avanza 3→5 con cita activa.",
  etiquetaBoton: "Aceptar y avanzar a Cita biométricos",
  mensajeConfirmacion:
    "¿Confirmas aceptar y avanzar este expediente a etapa 4: Cita agendada (biométricos)?",
  mostrarAvisoSinRechazo: true,
};

export const MESA_AVANCE_OPERATIVO_3A5_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "El expediente está en Listo cita biométricos (etapa 3) con notificación agendada. Confirma el avance a Inscripción (etapa 5).",
  etiquetaBoton: "Aprobar notificación y pasar a Inscripción",
  mensajeConfirmacion:
    "¿Confirmas aprobar la notificación y avanzar este expediente a etapa 5: Inscripción?",
  mostrarAvisoSinRechazo: true,
};

export const MESA_AVANCE_OPERATIVO_4A5_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "Confirma que la cita biométrica está agendada para continuar a resultado biométrico (etapa 5).",
  etiquetaBoton: "Aceptar cita biométrica y avanzar",
  mensajeConfirmacion:
    "¿Confirmas aceptar la cita biométrica y avanzar este expediente a etapa 5?",
  mostrarAvisoSinRechazo: true,
};

export const MESA_AVANCE_OPERATIVO_5A6_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "La cita biométrica ya ocurrió. Confirma el avance a Inscripción (etapa 6).",
  etiquetaBoton: "Aceptar post-cita biométrica y avanzar",
  mensajeConfirmacion:
    "¿Confirmas aceptar post-cita biométrica y avanzar este expediente a etapa 6?",
  mostrarAvisoSinRechazo: true,
};

export const MESA_AVANCE_OPERATIVO_6A7_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "El expediente está en Inscripción (etapa 6). Confirma el avance a Notificación (etapa 7).",
  etiquetaBoton: "Aceptar y avanzar a Notificación",
  mensajeConfirmacion:
    "¿Confirmas aceptar y avanzar este expediente a etapa 7: Notificación?",
  mostrarAvisoSinRechazo: true,
};

export const MESA_AVANCE_OPERATIVO_7A8_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "El expediente está en Notificación (etapa 7). Confirma el avance a Acuse / Aviso de retención (etapa 8).",
  etiquetaBoton: "Aceptar y avanzar a Acuse / Aviso de retención",
  mensajeConfirmacion:
    "¿Confirmas aceptar y avanzar este expediente a etapa 8: Acuse / Aviso de retención?",
  mostrarAvisoSinRechazo: true,
};

export const MESA_AVANCE_OPERATIVO_8A9_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "El Acuse ya fue enviado por el asesor. Puedes aceptar y avanzar a agenda de firma (etapa 9) si el expediente aún está en etapa 8.",
  etiquetaBoton: "Aceptar retención y avanzar a Firma",
  mensajeConfirmacion:
    "¿Confirmas aceptar la retención y avanzar este expediente a etapa 9: Listo agendar firma?",
};

export const MESA_AVANCE_OPERATIVO_9A10_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "La cita de firma está agendada. Puedes aceptar y avanzar a Cita para firma (etapa 10).",
  etiquetaBoton: "Aceptar cita de firma y avanzar",
  mensajeConfirmacion:
    "¿Confirmas aceptar la cita de firma y avanzar este expediente a etapa 10?",
  mostrarAvisoSinRechazo: true,
};

/** Etapa 10 (visible 9): Mesa avanza a Firmado (interna 11 / visible 10). */
export const MESA_FIRMA_ETAPA10_OPERATIVA_COPY: MesaAvanceOperativoCopy = {
  titulo: MESA_DECISION_TITULO_AVANCE,
  descripcion:
    "El expediente está en Cita para firma (etapa 10). Cuando la firma se complete, avanza a Firmado. Si el cliente no puede asistir, cancela la cita y solicita reagenda al asesor.",
  etiquetaBoton: "Pasar a Firmado",
  mensajeConfirmacion:
    "¿Confirmas pasar este expediente a Firmado (etapa 11)? Se conservan la cita, el booking y los documentos.",
  mostrarAvisoSinRechazo: true,
};

/** Etapas 9 y 10: resumen cita firma en Mesa (P3R.0). */
export function citaFirmaVisibleEnMesa(etapaActual: number | null | undefined): boolean {
  return etapaActual === 9 || etapaActual === 10;
}

/** Validar/rechazar datos generales: solo etapa documental (1). */
export function mesaPuedeRevisarClienteDatos(etapaActual: number | null | undefined): boolean {
  return etapaActual === 1;
}

/** Validar/rechazar documentos de integración: solo etapa documental (1). */
export function mesaPuedeRevisarDocumentosIntegracion(
  etapaActual: number | null | undefined,
): boolean {
  return etapaActual === 1;
}

/**
 * Validar/rechazar retención (P079): Mesa ya no valida el Acuse;
 * el envío del asesor avanza 8→9. Se conserva la función por compatibilidad UI.
 */
export function mesaPuedeRevisarRetencionDocumentos(
  etapaActual: number | null | undefined,
  enviadoAMesa: boolean,
): boolean {
  void etapaActual;
  void enviadoAMesa;
  return false;
}

/** Consulta datos generales: visible en todas las etapas. */
export function mostrarMesaClienteDatosConsulta(): boolean {
  return true;
}

/** Consulta documentos integración: visible en todas las etapas. */
export function mostrarMesaIntegracionDocsConsulta(): boolean {
  return true;
}

/** Consulta retención: etapa 8+ o si ya hay opción/envío. */
export function mostrarMesaRetencionConsulta(params: {
  etapaActual: number | null | undefined;
  tieneRetencionMeta: boolean;
}): boolean {
  if (params.tieneRetencionMeta) return true;
  const etapa = params.etapaActual;
  return typeof etapa === "number" && etapa >= 8;
}

/**
 * Panel documentos integración: etapa 1 siempre; fuera de 1 solo si hay correcciones pendientes.
 */
export function mostrarMesaIntegracionDocsPanel(params: {
  etapaActual: number | null | undefined;
  archivosResumen: readonly ExpedienteArchivoResumen[];
}): boolean {
  if (params.etapaActual === 1) return true;

  const resumen = integrationDocsResumenFromArchivoResumen(params.archivosResumen);
  const byTipo = new Map(resumen.map((r) => [r.tipo_documento, r.estatus_revision]));

  for (const tipo of INTEGRATION_DOC_TIPOS_VALIDACION_MESA) {
    const estatus = byTipo.get(tipo) ?? "faltante";
    if (estatus === "rechazado" || estatus === "resubido" || estatus === "subido") {
      return true;
    }
  }

  return false;
}

/**
 * Panel datos generales: etapa 1; o rechazado en cualquier etapa; o etapa 8+ sin validar (bloquea 8→9).
 */
export function mostrarMesaClienteDatosPanel(params: {
  etapaActual: number | null | undefined;
  estado: ExpedienteClienteDatosEstado | null | undefined;
  tieneDatos: boolean;
}): boolean {
  if (!params.tieneDatos) return false;
  if (params.etapaActual === 1) return true;
  if (params.estado === "rechazado") return true;
  if (
    typeof params.etapaActual === "number" &&
    params.etapaActual >= 8 &&
    params.estado !== "validado"
  ) {
    return true;
  }
  return false;
}
