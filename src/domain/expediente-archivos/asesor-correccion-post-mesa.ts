import type { ResumenEstatus } from "./types";
import {
  CLIENTE_SEMANAS_O_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  isIntegrationDocAsesorOpcionalTipo,
  type IntegrationDocAsesorUploadTipo,
} from "./integration-docs-completos";
import { INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA } from "./asesor-documentos-obligatorios-envio";

/**
 * Tipos que el reingreso activo permite subir/reemplazar post-envío.
 * Espejo de `integration_doc_tipos_asesor_upload()` — no incluye Mesa-only
 * (`cliente_acta_nacimiento`, `cliente_constancia_sat`, Pagaré, Solicitud, etc.).
 */
export const REINGRESO_DOC_TIPOS_ACTUALIZABLES = [
  ...INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
] as const;

export type ReingresoDocActualizableTipo =
  (typeof REINGRESO_DOC_TIPOS_ACTUALIZABLES)[number];

export function isReingresoDocActualizableTipo(
  tipo: string,
): tipo is ReingresoDocActualizableTipo {
  return (REINGRESO_DOC_TIPOS_ACTUALIZABLES as readonly string[]).includes(tipo);
}

/**
 * Reingreso con corrección completa (Datos Generales + docs asesor):
 * - P072 hijo (padre + rechazo) en etapa 6; o
 * - reingreso manual del mismo expediente (count > 0) **mientras etapa_actual = 1**.
 *
 * Cierre: al avanzar Mesa fuera de etapa 1 (manual) o fuera de etapa 6 (P072),
 * se vuelven a aplicar las reglas post-Mesa normales.
 */
export function esReingresoDocumentosEditables(params: {
  tieneReingresoPostBiometricos: boolean;
  etapaActual: number | null | undefined;
  reingresoManualCount?: number | null;
}): boolean {
  const etapa = Number(params.etapaActual ?? 0);
  const manual =
    Number(params.reingresoManualCount ?? 0) > 0 && etapa === 1;
  if (manual) return true;
  return params.tieneReingresoPostBiometricos && etapa === 6;
}

/** Alias canónico: misma ventana de edición para Datos Generales. */
export function esReingresoDatosEditables(params: {
  tieneReingresoPostBiometricos: boolean;
  etapaActual: number | null | undefined;
  reingresoManualCount?: number | null;
}): boolean {
  return esReingresoDocumentosEditables(params);
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
 * Compatibilidad del rollout Equipo Silvia.
 *
 * Expedientes enviados antes de que existiera el slot combinado pueden quedar
 * post-Mesa con `cliente_semanas_o_vigencia_derechos` en estado faltante.
 * La defensa SQL decide si el expediente concreto es grandfathered; en UI este
 * tipo se habilita para que el usuario pueda intentar completar el faltante.
 * No abre otros documentos obligatorios faltantes.
 */
export function asesorPuedeSubirSemanasOVigenciaFaltantePostMesa(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
  tipoDocumento: string,
): boolean {
  return (
    submittedToMesa &&
    estatusRevision === "faltante" &&
    tipoDocumento === CLIENTE_SEMANAS_O_VIGENCIA_DERECHOS_DOCUMENT_TIPO
  );
}

/**
 * Compatibilidad rollout Equipo Silvia para expedientes ya enviados a Mesa:
 * permite intentar el primer upload de un obligatorio actual que siga faltante.
 * La UI debe pasar `esPaqueteSilvia=true`; SQL/RLS vuelve a validar equipo,
 * dueño, rollout y ausencia real del documento.
 */
export function asesorPuedeSubirObligatorioSilviaFaltantePostMesa(
  submittedToMesa: boolean,
  estatusRevision: ResumenEstatus,
  tipoDocumento: string,
  esPaqueteSilvia: boolean,
): boolean {
  return (
    submittedToMesa &&
    estatusRevision === "faltante" &&
    esPaqueteSilvia &&
    (INTEGRATION_DOC_TIPOS_ASESOR_ENVIO_SILVIA as readonly string[]).includes(
      tipoDocumento,
    )
  );
}

/**
 * Reingreso activo: cualquier tipo de `integration_doc_tipos_asesor_upload`
 * (faltante o con archivo) editable aunque el expediente ya esté enviado a Mesa.
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
  esPaqueteSilvia = false,
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
  if (
    tipoDocumento &&
    asesorPuedeSubirObligatorioSilviaFaltantePostMesa(
      submittedToMesa,
      estatusRevision,
      tipoDocumento,
      esPaqueteSilvia,
    )
  ) {
    return true;
  }
  if (
    tipoDocumento &&
    asesorPuedeSubirSemanasOVigenciaFaltantePostMesa(
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
  esPaqueteSilvia?: boolean;
}): boolean {
  if (params.forceReadOnly) return false;
  const permitido = asesorPuedeSubirOCorregirDocumento(
    params.submittedToMesa,
    params.estatusRevision,
    params.tipoDocumento,
    params.esReingresoActivo ?? false,
    params.esPaqueteSilvia ?? false,
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
  esPaqueteSilvia = false,
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
    asesorPuedeSubirObligatorioSilviaFaltantePostMesa(
      submittedToMesa,
      estatusRevision,
      tipoDocumento,
      esPaqueteSilvia,
    )
  ) {
    return "normal";
  }
  if (
    tipoDocumento &&
    asesorPuedeSubirSemanasOVigenciaFaltantePostMesa(
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
  options?: { puedeIntegrar?: boolean; esReingresoActivo?: boolean },
): boolean {
  const puedeIntegrar = options?.puedeIntegrar ?? true;
  const esReingresoActivo = options?.esReingresoActivo ?? false;
  return puedeIntegrar || esReingresoActivo;
}

/** Post-envío a Mesa: siempre vía corrección/actualización (incluye primer alta en reingreso). */
export function asesorDebeUsarCorreccionClienteDatos(
  submittedToMesa: boolean,
  _tieneDatosGuardados = false,
): boolean {
  return submittedToMesa;
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
