import type { ResumenEstatus } from "./types";
import {
  isIntegrationDocAsesorOpcionalTipo,
  type IntegrationDocAsesorUploadTipo,
} from "./integration-docs-completos";

/** Tipos que el reingreso exige poder subir/reemplazar post-envío. */
export const REINGRESO_DOC_TIPOS_ACTUALIZABLES = [
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
] as const;

export type ReingresoDocActualizableTipo =
  (typeof REINGRESO_DOC_TIPOS_ACTUALIZABLES)[number];

export function isReingresoDocActualizableTipo(
  tipo: string,
): tipo is ReingresoDocActualizableTipo {
  return (REINGRESO_DOC_TIPOS_ACTUALIZABLES as readonly string[]).includes(tipo);
}

/**
 * Reingreso con docs domicilio/estado de cuenta editables:
 * - P072 hijo (padre + rechazo) en etapa 6; o
 * - reingreso manual del mismo expediente (count > 0).
 */
export function esReingresoDocumentosEditables(params: {
  tieneReingresoPostBiometricos: boolean;
  etapaActual: number | null | undefined;
  reingresoManualCount?: number | null;
}): boolean {
  const manual = Number(params.reingresoManualCount ?? 0) > 0;
  if (manual) return true;
  return (
    params.tieneReingresoPostBiometricos &&
    params.etapaActual === 6
  );
}

/** Upload inicial pre-envío a Mesa (5 oblig + opcionales). */
export function asesorPuedeSubirDocumentoPreMesa(submittedToMesa: boolean): boolean {
  return !submittedToMesa;
}

/** Corrección post-Mesa: solo documentos rechazados explícitamente. */
export function asesorPuedeCorregirDocumentoRechazado(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
): boolean {
  return submittedToMesa && estatusRevision === "rechazado";
}

/** Post-Mesa: primer upload de opcional que no se envió antes del envío. */
export function asesorPuedeSubirOpcionalFaltantePostMesa(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
  tipoDocumento: IntegrationDocAsesorUploadTipo,
): boolean {
  return (
    submittedToMesa &&
    estatusRevision === "faltante" &&
    isIntegrationDocAsesorOpcionalTipo(tipoDocumento)
  );
}

/**
 * Reingreso: domicilio y estado de cuenta (faltante o con archivo) editables
 * aunque el expediente ya esté enviado a Mesa.
 */
export function asesorPuedeActualizarDocReingreso(
  submittedToMesa: boolean,
  tipoDocumento: IntegrationDocAsesorUploadTipo,
  esReingresoActivo: boolean,
): boolean {
  return (
    submittedToMesa &&
    esReingresoActivo &&
    isReingresoDocActualizableTipo(tipoDocumento)
  );
}

/** @deprecated Usar asesorPuedeActualizarDocReingreso (cubre faltante y reemplazo). */
export function asesorPuedeSubirDocumentoNuevoReingreso(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
  tipoDocumento: IntegrationDocAsesorUploadTipo,
  esReingresoActivo: boolean,
): boolean {
  return (
    asesorPuedeActualizarDocReingreso(
      submittedToMesa,
      tipoDocumento,
      esReingresoActivo,
    ) && estatusRevision === "faltante"
  );
}

/** Post-Mesa: reemplazar documento ya registrado (sin reenviar expediente). */
export function asesorPuedeReemplazarDocumentoExistentePostMesa(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
): boolean {
  return (
    submittedToMesa &&
    estatusRevision !== "faltante" &&
    estatusRevision !== "rechazado"
  );
}

export function asesorPuedeSubirOCorregirDocumento(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
  tipoDocumento?: IntegrationDocAsesorUploadTipo,
  esReingresoActivo = false,
): boolean {
  if (!submittedToMesa) return true;
  if (asesorPuedeCorregirDocumentoRechazado(submittedToMesa, estatusRevision)) {
    return true;
  }
  if (
    tipoDocumento &&
    asesorPuedeActualizarDocReingreso(
      submittedToMesa,
      tipoDocumento,
      esReingresoActivo,
    )
  ) {
    return true;
  }
  if (
    tipoDocumento &&
    asesorPuedeSubirOpcionalFaltantePostMesa(
      submittedToMesa,
      estatusRevision,
      tipoDocumento,
    )
  ) {
    return true;
  }
  if (asesorPuedeReemplazarDocumentoExistentePostMesa(submittedToMesa, estatusRevision)) {
    return true;
  }
  return false;
}

/**
 * Post-Mesa: no exigir monto/`puedeIntegrar` si las reglas documentales ya permiten
 * (reingreso, reemplazo, opcional faltante, corrección).
 */
export function asesorPuedeMostrarUploadDocumento(params: {
  puedeIntegrar: boolean;
  submittedToMesa: boolean;
  estatusRevision: ResumenEstatus;
  tipoDocumento: IntegrationDocAsesorUploadTipo;
  esReingresoActivo?: boolean;
  forceReadOnly?: boolean;
}): boolean {
  if (params.forceReadOnly) return false;
  const permitido = asesorPuedeSubirOCorregirDocumento(
    params.submittedToMesa,
    params.estatusRevision,
    params.tipoDocumento,
    params.esReingresoActivo ?? false,
  );
  if (!permitido) return false;
  if (!params.submittedToMesa) return params.puedeIntegrar;
  return true;
}

export function asesorDebeUsarCorreccionDocumento(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
): boolean {
  return asesorPuedeCorregirDocumentoRechazado(submittedToMesa, estatusRevision);
}

export type AsesorDocumentoUploadMode = "normal" | "correccion";

export function asesorDocumentoUploadMode(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
  tipoDocumento?: IntegrationDocAsesorUploadTipo,
  esReingresoActivo = false,
): AsesorDocumentoUploadMode | null {
  if (!submittedToMesa) return "normal";
  if (estatusRevision === "rechazado") return "correccion";
  if (
    tipoDocumento &&
    asesorPuedeSubirOpcionalFaltantePostMesa(
      submittedToMesa,
      estatusRevision,
      tipoDocumento,
    )
  ) {
    return "normal";
  }
  if (
    tipoDocumento &&
    asesorPuedeActualizarDocReingreso(
      submittedToMesa,
      tipoDocumento,
      esReingresoActivo,
    )
  ) {
    return "normal";
  }
  if (asesorPuedeReemplazarDocumentoExistentePostMesa(submittedToMesa, estatusRevision)) {
    return "normal";
  }
  return null;
}

export function asesorPuedeEditarClienteDatos(
  _submittedToMesa: boolean,
  _estado: "pendiente" | "completo" | "validado" | "rechazado",
): boolean {
  return true;
}

/** Post-envío a Mesa: guardar vía RPC de corrección/actualización (no `save` inicial). */
export function asesorDebeUsarCorreccionClienteDatos(
  submittedToMesa: boolean,
  tieneDatosGuardados: boolean,
): boolean {
  return submittedToMesa && tieneDatosGuardados;
}

/** Corrección tras rechazo explícito de Mesa (limpia rechazo y vuelve a completo). */
export function asesorEsCorreccionRechazoClienteDatos(
  submittedToMesa: boolean,
  estado: "pendiente" | "completo" | "validado" | "rechazado",
): boolean {
  return submittedToMesa && estado === "rechazado";
}

export type CorreccionDocumentoParams = {
  expedienteId: string;
  tipo_documento: IntegrationDocAsesorUploadTipo;
  file: File;
};
