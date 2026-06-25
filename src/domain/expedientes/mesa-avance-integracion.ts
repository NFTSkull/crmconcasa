import {
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  integrationDocsResumenFromArchivoResumen,
  integrationDocsTodosValidados,
} from "@/domain/expediente-archivos/integration-docs-completos";
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

function labelDocumento(tipo: (typeof INTEGRATION_DOC_TIPOS_VALIDACION_MESA)[number]): string {
  return DOCUMENTO_CATALOGO_MAP[tipo]?.label ?? tipo;
}

function mensajeEstatusPendiente(estatus: ResumenEstatus): string {
  if (estatus === "rechazado") return "rechazado";
  if (estatus === "resubido") return "resubido (pendiente de validar)";
  if (estatus === "subido") return "subido (pendiente de validar)";
  return estatus;
}

/** Muestra el bloque Continuar solo en integración post-envío (etapa 1, en validación Mesa). */
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
      if (tipo === "cliente_acta_nacimiento") {
        bloqueos.push("Falta acta de nacimiento (debe subirla Mesa de control).");
      } else if (tipo === "cliente_constancia_sat") {
        bloqueos.push("Falta constancia SAT (debe subirla Mesa de control).");
      } else {
        bloqueos.push(`Documento obligatorio faltante: ${label}.`);
      }
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
