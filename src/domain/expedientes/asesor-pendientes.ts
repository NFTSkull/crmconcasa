/**
 * Pendientes canónicos del asesor (correcciones Mesa + siguientes acciones).
 * Una sola semántica para chips, contadores, detalle y notificaciones.
 */

import {
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
} from "@/domain/expediente-archivos/integration-docs-completos";
import type { ExpedienteArchivoResumen } from "@/domain/expediente-archivos/types";
import { isRetencionPrincipalDocumentTipo } from "@/lib/fileUploadValidation";
import {
  hasAcusePrincipalValido,
  isAsesorPendienteAgendarBiometricos,
  isAsesorPendienteAgendarFirma,
  isAsesorPendienteSubirAcuse,
  type AsesorTareaExpedienteInput,
} from "@/lib/asesorTareasPendientes";

/** Docs que el asesor puede corregir tras rechazo Mesa (integración + complementarios). */
export const ASESOR_DOC_TIPOS_CORREGIBLES = [
  ...INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  ...INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
] as const;

export type AsesorCorreccionItemKind =
  | "datos_generales"
  | "documento"
  | "acuse";

export type AsesorCorreccionItem = Readonly<{
  kind: AsesorCorreccionItemKind;
  key: string;
  label: string;
}>;

export type AsesorPendingActionKind =
  | "necesita_correccion"
  | "subir_acuse"
  | "corregir_acuse"
  | "agendar_biometricos"
  | "reagendar_biometricos"
  | "agendar_firma"
  | "reagendar_firma"
  | null;

const DOC_LABEL: Record<string, string> = {
  cliente_ine_frente: "INE frente",
  cliente_ine_reverso: "INE reverso",
  cliente_comprobante_domicilio: "Comprobante de domicilio",
  cliente_estado_cuenta: "Estado de cuenta",
  cliente_semanas_cotizadas: "Semanas cotizadas",
  cliente_acta_nacimiento: "Acta de nacimiento",
  cliente_constancia_sat: "Constancia SAT",
  retencion_acuse_con_sello: "Acuse con sello",
  retencion_carta_sin_sello: "Carta sin sello",
  ine: "INE",
  estado_cuenta: "Estado de cuenta",
  nss: "NSS",
  direccion: "Dirección",
};

function isCorregibleTipo(tipo: string): boolean {
  if ((ASESOR_DOC_TIPOS_CORREGIBLES as readonly string[]).includes(tipo)) {
    return true;
  }
  if (tipo === "ine" || tipo === "estado_cuenta" || tipo === "nss" || tipo === "direccion") {
    return true;
  }
  return isRetencionPrincipalDocumentTipo(tipo);
}

export function listAsesorCorreccionesAbiertas(params: {
  clienteDatosEstado?: string | null;
  archivos?: readonly ExpedienteArchivoResumen[] | null;
  retencionEnvioEstado?: string | null;
}): readonly AsesorCorreccionItem[] {
  const items: AsesorCorreccionItem[] = [];

  if (params.clienteDatosEstado === "rechazado") {
    items.push({
      kind: "datos_generales",
      key: "datos_generales",
      label: "Datos generales",
    });
  }

  const seenTipos = new Set<string>();
  for (const row of params.archivos ?? []) {
    const tipo = String(row.tipo_documento ?? "");
    if (!tipo || seenTipos.has(tipo)) continue;
    if (row.estatus_revision !== "rechazado") continue;
    if (!isCorregibleTipo(tipo)) continue;
    seenTipos.add(tipo);
    const isAcuse = isRetencionPrincipalDocumentTipo(tipo);
    items.push({
      kind: isAcuse ? "acuse" : "documento",
      key: tipo,
      label: DOC_LABEL[tipo] ?? tipo,
    });
  }

  if (
    params.retencionEnvioEstado === "correccion_requerida" &&
    !items.some((i) => i.kind === "acuse")
  ) {
    items.push({
      kind: "acuse",
      key: "acuse",
      label: "Acuse",
    });
  }

  return items;
}

export function countAsesorCorreccionesAbiertas(
  params: Parameters<typeof listAsesorCorreccionesAbiertas>[0],
): number {
  return listAsesorCorreccionesAbiertas(params).length;
}

export function hasAsesorCorreccionAbierta(
  params: Parameters<typeof listAsesorCorreccionesAbiertas>[0],
): boolean {
  return countAsesorCorreccionesAbiertas(params) > 0;
}

export function isAsesorReagendarBiometricos(
  input: AsesorTareaExpedienteInput,
): boolean {
  return (
    isAsesorPendienteAgendarBiometricos(input) &&
    Boolean(input.agendaBiometricos?.hasLastCancelledBooking) &&
    input.etapaActual !== 3
  );
}

export function isAsesorCorregirAcuse(input: AsesorTareaExpedienteInput): boolean {
  if (!isAsesorPendienteSubirAcuse(input)) return false;
  const principalRechazado = (input.archivos ?? []).some(
    (r) =>
      isRetencionPrincipalDocumentTipo(r.tipo_documento) &&
      r.estatus_revision === "rechazado",
  );
  return principalRechazado || input.retencion?.envio?.estado === "correccion_requerida";
}

export function labelAsesorAcusePendiente(input: AsesorTareaExpedienteInput): string {
  return isAsesorCorregirAcuse(input) ? "Corregir Acuse" : "Subir Acuse";
}

export function isAsesorReagendarFirma(input: AsesorTareaExpedienteInput): boolean {
  return (
    isAsesorPendienteAgendarFirma(input) &&
    input.etapaActual === 10 &&
    Boolean(input.agendaFirmas?.hasLastCancelledBooking)
  );
}

export function getAdvisorPrimaryPendingAction(params: {
  correccionesAbiertas: number;
  tarea: AsesorTareaExpedienteInput;
}): AsesorPendingActionKind {
  if (params.correccionesAbiertas > 0) return "necesita_correccion";

  if (isAsesorPendienteSubirAcuse(params.tarea)) {
    return isAsesorCorregirAcuse(params.tarea) ? "corregir_acuse" : "subir_acuse";
  }

  if (isAsesorPendienteAgendarBiometricos(params.tarea)) {
    return isAsesorReagendarBiometricos(params.tarea)
      ? "reagendar_biometricos"
      : "agendar_biometricos";
  }

  if (isAsesorPendienteAgendarFirma(params.tarea)) {
    return isAsesorReagendarFirma(params.tarea) ? "reagendar_firma" : "agendar_firma";
  }

  return null;
}

export function labelAdvisorPendingAction(kind: AsesorPendingActionKind): string | null {
  switch (kind) {
    case "necesita_correccion":
      return "Necesita corrección";
    case "subir_acuse":
      return "Subir Acuse";
    case "corregir_acuse":
      return "Corregir Acuse";
    case "agendar_biometricos":
      return "Agendar biométricos";
    case "reagendar_biometricos":
      return "Reagendar biométricos";
    case "agendar_firma":
      return "Agendar firma";
    case "reagendar_firma":
      return "Reagendar firma";
    default:
      return null;
  }
}

export function formatCorreccionesPendientesCopy(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "Mesa solicita corregir 1 elemento.";
  return `Mesa solicita corregir ${count} elementos.`;
}

export function asesorAcuseResuelto(
  archivos: readonly ExpedienteArchivoResumen[] | null | undefined,
): boolean {
  return hasAcusePrincipalValido(archivos);
}
