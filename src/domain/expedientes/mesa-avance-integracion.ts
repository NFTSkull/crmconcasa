import {
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  integrationDocsResumenFromArchivoResumen,
  integrationDocsTodosValidados,
} from "@/domain/expediente-archivos/integration-docs-completos";
import {
  labelPresenciaComplementario,
  type MesaComplementarioPresencia,
} from "@/domain/expediente-archivos/mesa-complementarios-docs";
import {
  DOCUMENTO_CATALOGO_MAP,
  type ExpedienteArchivoResumen,
  type ResumenEstatus,
} from "@/domain/expediente-archivos/types";

export type MesaContinuarIntegracionContext = {
  submittedToMesa: boolean;
  cicloEstado?: string | null;
  etapaActual: number | null;
  subestado?: string | null;
  clienteDatosEstado?: string | null;
  archivosResumen: readonly ExpedienteArchivoResumen[];
};

export type CierreDocumentalDocAsesorItem = {
  tipo: (typeof INTEGRATION_DOC_TIPOS_VALIDACION_MESA)[number];
  label: string;
  estatus: ResumenEstatus;
  completo: boolean;
  detalle: string | null;
};

export type CierreDocumentalComplementarioItem = {
  tipo: (typeof INTEGRATION_DOC_TIPOS_MESA_UPLOAD)[number];
  label: string;
  presencia: MesaComplementarioPresencia;
  detalle: string;
};

export type CierreValidacionDocumentalView = {
  mostrar: boolean;
  datosGeneralesValidados: boolean;
  datosGeneralesDetalle: string;
  documentosAsesor: CierreDocumentalDocAsesorItem[];
  complementarios: CierreDocumentalComplementarioItem[];
  puedeAvanzar: boolean;
  bloqueos: string[];
};

function labelDocumento(tipo: (typeof INTEGRATION_DOC_TIPOS_VALIDACION_MESA)[number]): string {
  return DOCUMENTO_CATALOGO_MAP[tipo]?.label ?? tipo;
}

function mensajeEstatusPendiente(estatus: ResumenEstatus): string {
  if (estatus === "rechazado") return "rechazado";
  if (estatus === "resubido") return "resubido (pendiente de validar)";
  if (estatus === "subido") return "subido (pendiente de validar)";
  if (estatus === "faltante") return "faltante";
  return estatus;
}

function mapComplementarioPresencia(estatus: ResumenEstatus): MesaComplementarioPresencia {
  if (estatus === "faltante") return "faltante";
  return "cargado";
}

/** Muestra el panel de cierre solo en integración post-envío (etapa 1, en validación Mesa). */
export function puedeMostrarContinuarIntegracion(ctx: MesaContinuarIntegracionContext): boolean {
  if (!ctx.submittedToMesa) return false;
  if (ctx.cicloEstado != null && ctx.cicloEstado !== "activo") return false;
  if (ctx.etapaActual == null || ctx.etapaActual >= 2) return false;
  return ctx.etapaActual === 1 && ctx.subestado === "en_validacion_mesa";
}

/** Bloqueos alineados con `avanzar_etapa_operativa` transición 1→2. */
export function deriveBloqueosContinuarIntegracion(
  ctx: MesaContinuarIntegracionContext,
): string[] {
  if (!puedeMostrarContinuarIntegracion(ctx)) {
    return [];
  }

  const bloqueos: string[] = [];

  if (ctx.clienteDatosEstado !== "validado") {
    bloqueos.push("Datos generales pendientes de validar por Mesa de control.");
  }

  const resumen = integrationDocsResumenFromArchivoResumen(ctx.archivosResumen);
  const byTipo = new Map(resumen.map((r) => [r.tipo_documento, r.estatus_revision]));

  for (const tipo of INTEGRATION_DOC_TIPOS_VALIDACION_MESA) {
    const estatus = byTipo.get(tipo) ?? "faltante";
    const label = labelDocumento(tipo);

    if (estatus === "faltante") {
      bloqueos.push(`Documento obligatorio faltante: ${label}.`);
      continue;
    }

    if (estatus !== "validado") {
      bloqueos.push(`${label}: ${mensajeEstatusPendiente(estatus)}.`);
    }
  }

  return bloqueos;
}

export function puedeContinuarIntegracion(ctx: MesaContinuarIntegracionContext): boolean {
  if (!puedeMostrarContinuarIntegracion(ctx)) return false;
  if (ctx.clienteDatosEstado !== "validado") return false;
  const resumen = integrationDocsResumenFromArchivoResumen(ctx.archivosResumen);
  return integrationDocsTodosValidados(resumen);
}

/** Vista estructurada para el panel «Cierre de validación documental». */
export function deriveCierreValidacionDocumentalView(
  ctx: MesaContinuarIntegracionContext,
): CierreValidacionDocumentalView {
  const mostrar = puedeMostrarContinuarIntegracion(ctx);
  const bloqueos = deriveBloqueosContinuarIntegracion(ctx);
  const resumen = integrationDocsResumenFromArchivoResumen(ctx.archivosResumen);
  const byTipo = new Map(resumen.map((r) => [r.tipo_documento, r.estatus_revision]));

  const datosGeneralesValidados = ctx.clienteDatosEstado === "validado";
  const datosGeneralesDetalle = datosGeneralesValidados
    ? "Validados por Mesa de control"
    : ctx.clienteDatosEstado
      ? `Estado actual: ${ctx.clienteDatosEstado}`
      : "Pendientes de validar";

  const documentosAsesor = INTEGRATION_DOC_TIPOS_VALIDACION_MESA.map((tipo) => {
    const estatus = byTipo.get(tipo) ?? "faltante";
    const completo = estatus === "validado";
    return {
      tipo,
      label: labelDocumento(tipo),
      estatus,
      completo,
      detalle: completo ? "Validado" : mensajeEstatusPendiente(estatus),
    };
  });

  const complementarios = INTEGRATION_DOC_TIPOS_MESA_UPLOAD.map((tipo) => {
    const estatus = byTipo.get(tipo) ?? "faltante";
    const presencia = mapComplementarioPresencia(estatus);
    return {
      tipo,
      label: DOCUMENTO_CATALOGO_MAP[tipo].label,
      presencia,
      detalle: `${labelPresenciaComplementario(presencia)} — opcional, no bloquea`,
    };
  });

  return {
    mostrar,
    datosGeneralesValidados,
    datosGeneralesDetalle,
    documentosAsesor,
    complementarios,
    puedeAvanzar: mostrar && bloqueos.length === 0,
    bloqueos,
  };
}

/** Tras avance 1→2 el panel no debe mostrarse y la etapa operativa pasa a 2. */
export function etapaTrasAvanceIntegracion1a2(etapaActual: number | null): number | null {
  return etapaActual != null && etapaActual >= 2 ? etapaActual : etapaActual;
}

// —— P3L.1: avance operativo Mesa 2 → 3 ——

export type MesaAvanceOperativoContext = {
  submittedToMesa: boolean;
  cicloEstado?: string | null;
  etapaActual: number | null;
  subestado?: string | null;
};

export type AvanceOperativoEtapaView = {
  mostrar: boolean;
  puedeAvanzar: boolean;
  bloqueos: string[];
};

/** @deprecated Usar `AvanceOperativoEtapaView`. */
export type AvanceOperativo2a3View = AvanceOperativoEtapaView;

/** @deprecated Usar `AvanceOperativoEtapaView`. */
export type AvanceOperativo3a4View = AvanceOperativoEtapaView;

/** Panel visible solo en etapa 2 / en_proceso post-registro (P2C-12). */
export function puedeMostrarAvanceOperativo2a3(ctx: MesaAvanceOperativoContext): boolean {
  if (!ctx.submittedToMesa) return false;
  if (ctx.cicloEstado != null && ctx.cicloEstado !== "activo") return false;
  if (ctx.etapaActual !== 2) return false;
  return ctx.subestado === "en_proceso";
}

export function deriveAvanceOperativo2a3View(
  ctx: MesaAvanceOperativoContext,
): AvanceOperativoEtapaView {
  const mostrar = puedeMostrarAvanceOperativo2a3(ctx);
  return {
    mostrar,
    puedeAvanzar: mostrar,
    bloqueos: [],
  };
}

/** Panel visible solo en etapa 3 / en_proceso (P2C-12). Ciclo debe ser `activo` (espejo SQL). */
export function puedeMostrarAvanceOperativo3a4(ctx: MesaAvanceOperativoContext): boolean {
  if (!ctx.submittedToMesa) return false;
  if (ctx.cicloEstado !== "activo") return false;
  if (ctx.etapaActual !== 3) return false;
  return ctx.subestado === "en_proceso";
}

export function deriveAvanceOperativo3a4View(
  ctx: MesaAvanceOperativoContext,
): AvanceOperativoEtapaView {
  const mostrar = puedeMostrarAvanceOperativo3a4(ctx);
  return {
    mostrar,
    puedeAvanzar: mostrar,
    bloqueos: [],
  };
}
