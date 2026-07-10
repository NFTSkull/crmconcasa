import type { MesaComplementarioDocView } from "@/domain/expediente-archivos/mesa-complementarios-docs";
import type { MesaIntegrationDocView } from "@/domain/expediente-archivos";
import type { ExpedienteClienteDatosEstado } from "@/domain/expediente-cliente-datos/types";
import type { RetencionEnvioMesaUiEstado } from "@/domain/expediente-retencion/retencion-envio-mesa";
import type { RetencionOpcion } from "@/domain/expediente-retencion/types";
import { labelRetencionOpcion } from "@/domain/expediente-archivos/retencion-acuse-aviso";
import type { AgendaBiometricosActiveBooking, AgendaNotificacionActiveBooking } from "@/domain/agenda-biometricos";
import type { AgendaFirmasActiveBooking } from "@/domain/agenda-firmas";

export type IntegracionDocsResumenCounts = Readonly<{
  total: number;
  validados: number;
  pendientes: number;
  rechazados: number;
  faltantes: number;
}>;

export function computeIntegracionDocsResumenCounts(
  documentos: readonly MesaIntegrationDocView[],
): IntegracionDocsResumenCounts {
  const obligatorios = documentos.filter((d) => !d.opcional);
  let validados = 0;
  let pendientes = 0;
  let rechazados = 0;
  let faltantes = 0;

  for (const item of obligatorios) {
    const e = item.estatus_revision;
    if (e === "validado") validados += 1;
    else if (e === "rechazado") rechazados += 1;
    else if (e === "subido" || e === "resubido") pendientes += 1;
    else faltantes += 1;
  }

  return {
    total: obligatorios.length,
    validados,
    pendientes,
    rechazados,
    faltantes,
  };
}

export function buildIntegracionDocsAccordionSummary(
  documentos: readonly MesaIntegrationDocView[],
): string {
  if (!documentos.length) return "Sin documentos en el checklist";
  const c = computeIntegracionDocsResumenCounts(documentos);
  const parts = [`${c.total} documentos`, `${c.validados} validados`];
  if (c.pendientes > 0) parts.push(`${c.pendientes} pendientes`);
  if (c.rechazados > 0) parts.push(`${c.rechazados} rechazados`);
  if (c.faltantes > 0) parts.push(`${c.faltantes} faltantes`);
  return parts.join(" · ");
}

function clienteDatosEstadoLabel(estado: ExpedienteClienteDatosEstado | null | undefined): string {
  if (estado === "validado") return "validado";
  if (estado === "rechazado") return "rechazado";
  if (estado === "completo") return "completo";
  if (estado === "pendiente") return "pendiente";
  return "sin datos";
}

export function buildClienteDatosAccordionSummary(params: {
  tieneDatos: boolean;
  estado: ExpedienteClienteDatosEstado | null | undefined;
}): string {
  if (!params.tieneDatos) return "Sin datos generales registrados";
  return `Datos generales: ${clienteDatosEstadoLabel(params.estado)}`;
}

export function buildComplementariosAccordionSummary(
  documentos: readonly MesaComplementarioDocView[],
): string {
  if (!documentos.length) return "Sin complementarios";
  const cargados = documentos.filter((d) => d.presencia === "cargado").length;
  return `${documentos.length} tipos · ${cargados} cargados`;
}

function retencionEnvioLabel(estado: RetencionEnvioMesaUiEstado): string {
  if (estado === "enviado") return "enviada";
  if (estado === "correccion_requerida") return "corrección requerida";
  if (estado === "no_enviado") return "no enviada";
  return estado;
}

export function buildRetencionAccordionSummary(params: {
  opcion: RetencionOpcion | null;
  envioUiEstado: RetencionEnvioMesaUiEstado;
}): string {
  const opcion = params.opcion ? labelRetencionOpcion(params.opcion) : "sin opción";
  return `Retención: ${retencionEnvioLabel(params.envioUiEstado)} · ${opcion}`;
}

export function buildAgendaAccordionSummary(params: {
  etapaActual: number | null;
  biometricBooking: AgendaBiometricosActiveBooking | null;
  notificacionBooking?: AgendaNotificacionActiveBooking | null;
  firmasBooking: AgendaFirmasActiveBooking | null;
  fechaCita: string | null | undefined;
}): string {
  const parts: string[] = [];
  if (params.notificacionBooking) {
    parts.push(`Notificación ${params.notificacionBooking.bookingDate} 12:00 PM`);
  }
  if (params.biometricBooking) {
    parts.push(`Biométricos ${params.biometricBooking.bookingDate} ${params.biometricBooking.bookingTime}`);
  } else if (
    params.fechaCita &&
    !params.notificacionBooking &&
    (params.etapaActual === 3 || params.etapaActual === 4 || params.etapaActual === 5)
  ) {
    parts.push("Biométricos registrados en expediente");
  }
  if (params.firmasBooking) {
    parts.push(`Firma ${params.firmasBooking.bookingDate} ${params.firmasBooking.bookingTime}`);
  } else if (params.etapaActual === 10) {
    parts.push("Firma pendiente de resultado");
  } else if (params.fechaCita && (params.etapaActual === 9 || params.etapaActual === 10)) {
    parts.push("Firma registrada en expediente");
  }
  if (!parts.length) return "Sin citas registradas";
  return parts.join(" · ");
}
