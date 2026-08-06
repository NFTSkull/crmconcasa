/**
 * Microcopy amigable del piloto CURP (solo UI).
 * No cambia enums internos ni contratos RPC.
 */

import type { ConstanciaStatus, RfcEstimadoStatus } from "./types";
import { CLIENTE_CONSTANCIA_CURP_CONTRACT } from "./types";

export const CONSTANCIA_CURP_DROPZONE_HINT =
  "Arrastra aquí la constancia PDF o haz clic para seleccionarla";

export const CONSTANCIA_CURP_FORMAT_HINT = `Formatos: ${CLIENTE_CONSTANCIA_CURP_CONTRACT.formatos.join(", ")} · Máx. ${Math.round(CLIENTE_CONSTANCIA_CURP_CONTRACT.maxBytes / (1024 * 1024))} MB`;

/** Estado de envío del expediente (no del archivo). */
export function labelConstanciaEnvioMesa(submittedToMesa: boolean): string {
  return submittedToMesa
    ? "✓ Constancia CURP enviada a Mesa y disponible para revisión."
    : "Constancia lista para enviar a Mesa.";
}

export function labelConstanciaStatus(status: ConstanciaStatus): string {
  switch (status) {
    case "CONSTANCIA_NO_ANALIZADA":
      return "Sin constancia analizada todavía.";
    case "CONSTANCIA_ANALIZANDO":
      return "Analizando constancia…";
    case "CONSTANCIA_LEGIBLE":
      return "La constancia se guardó correctamente.";
    case "PDF_NO_LEGIBLE":
      return "No pudimos leer el texto de la constancia. El archivo sí se guardó.";
    case "CURP_CERTIFICADA_REGISTRO_CIVIL":
      return "✓ CURP certificada por el Registro Civil";
    case "CURP_NO_CERTIFICADA":
      return "Certificación del Registro Civil pendiente de confirmar.";
    case "CERTIFICACION_OTRA_AUTORIDAD":
      return "Certificación de otra autoridad. Datos por confirmar.";
    case "DATOS_NO_COINCIDEN":
      return "Algunos datos de la constancia no coinciden con el expediente.";
    case "ERROR_ANALISIS":
      return "No pudimos analizar automáticamente la constancia. El archivo sí se guardó.";
    default:
      return "Datos por confirmar.";
  }
}

export function labelCertificacionRegistroCivil(
  status: ConstanciaStatus,
): string {
  if (status === "CURP_CERTIFICADA_REGISTRO_CIVIL") {
    return "✓ CURP certificada por el Registro Civil";
  }
  if (
    status === "CONSTANCIA_NO_ANALIZADA" ||
    status === "CONSTANCIA_ANALIZANDO"
  ) {
    return "Certificación del Registro Civil pendiente de confirmar.";
  }
  return "Certificación del Registro Civil pendiente de confirmar.";
}

export function labelRfcEstimadoUi(status: RfcEstimadoStatus): string {
  switch (status) {
    case "SIN_DATOS":
    case "ESTIMACION_PENDIENTE":
      return "Datos por confirmar.";
    case "RFC_ESTIMADO":
    case "RFC_ESTIMADO_APLICADO":
    case "RFC_CAPTURADO_COINCIDE":
    case "RFC_CAPTURADO_NO_COINCIDE":
      return "RFC estimado (pendiente de confirmación oficial).";
    case "RFC_VALIDACION_SAT_PENDIENTE":
      return "Confirmación oficial pendiente.";
    case "RFC_OFICIAL_CONFIRMADO":
      return "RFC confirmado.";
    default:
      return "Datos por confirmar.";
  }
}

export function labelEstadoValidacionMesa(estado: string | null | undefined): string {
  if (!estado) return "—";
  switch (estado) {
    case "VALIDA_LOCALMENTE":
      return "Formato de CURP válido";
    case "CURP_CERTIFICADA_REGISTRO_CIVIL":
      return "✓ CURP certificada por el Registro Civil";
    case "CONSTANCIA_LEGIBLE":
      return "La constancia se guardó correctamente.";
    case "PDF_NO_LEGIBLE":
    case "ERROR_ANALISIS":
      return "No pudimos analizar automáticamente la constancia.";
    case "CURP_NO_CERTIFICADA":
    case "CERTIFICACION_OTRA_AUTORIDAD":
      return "Certificación del Registro Civil pendiente de confirmar.";
    case "DATOS_NO_COINCIDEN":
      return "Algunos datos no coinciden.";
    case "RFC_VALIDACION_SAT_PENDIENTE":
      return "Confirmación oficial pendiente.";
    case "SIN_CURP":
      return "Sin CURP capturada.";
    case "FORMATO_INVALIDO":
    case "DIGITO_INVALIDO":
      return "CURP con formato inválido.";
    default:
      if (estado.startsWith("RFC_")) return "RFC estimado (pendiente de confirmación oficial).";
      return "Datos por confirmar.";
  }
}
