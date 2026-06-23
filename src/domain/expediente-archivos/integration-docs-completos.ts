import {
  DOCUMENTO_CATALOGO_MAP,
  type ExpedienteArchivoResumen,
  type ResumenEstatus,
  type TipoDocumentoCatalogo,
} from "./types";

/**
 * Espejo de `integration_doc_tipos_asesor_envio()` (migración 028).
 * Documentos obligatorios que el asesor debe completar antes de `enviar_a_mesa`.
 */
export const INTEGRATION_DOC_TIPOS_ASESOR_ENVIO = [
  "nss",
  "cliente_ine_frente",
  "cliente_ine_reverso",
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
] as const;

/**
 * Espejo de `integration_doc_tipos_asesor_opcionales()` — no bloquean envío.
 */
export const INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES = [
  "cliente_semanas_cotizadas",
] as const;

/**
 * Espejo de `integration_doc_tipos_asesor_upload()` — permitidos en Storage/RPC (6).
 */
export const INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD = [
  ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  ...INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES,
] as const;

/**
 * Espejo de `integration_doc_tipos_obligatorios()` — validación Mesa (7).
 * Incluye acta y constancia SAT (sube Mesa de Control).
 */
export const INTEGRATION_DOC_TIPOS_VALIDACION_MESA = [
  ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  "cliente_acta_nacimiento",
  "cliente_constancia_sat",
] as const;

/** @deprecated Usar `INTEGRATION_DOC_TIPOS_ASESOR_ENVIO` o `INTEGRATION_DOC_TIPOS_VALIDACION_MESA`. */
export const INTEGRATION_DOC_TIPOS_OBLIGATORIOS = INTEGRATION_DOC_TIPOS_VALIDACION_MESA;

export type IntegrationDocAsesorEnvioTipo =
  (typeof INTEGRATION_DOC_TIPOS_ASESOR_ENVIO)[number];

export type IntegrationDocAsesorOpcionalTipo =
  (typeof INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES)[number];

export type IntegrationDocAsesorUploadTipo =
  (typeof INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD)[number];

/** @deprecated Usar `IntegrationDocAsesorEnvioTipo` o `IntegrationDocAsesorUploadTipo`. */
export type IntegrationDocTipo = IntegrationDocAsesorEnvioTipo;

const ESTATUS_CUENTA_INTEGRACION = new Set<ResumenEstatus>([
  "subido",
  "resubido",
  "validado",
]);

export type IntegrationDocChecklistItem = {
  tipo_documento: IntegrationDocAsesorUploadTipo;
  label: string;
  estatus_revision: ResumenEstatus;
  completo: boolean;
  opcional: boolean;
};

export type IntegrationDocsResumenInput = ReadonlyArray<{
  tipo_documento: TipoDocumentoCatalogo;
  estatus_revision: ResumenEstatus;
}>;

/** `true` si el estatus cuenta para `enviar_a_mesa` / `count_integration_docs_presentes`. */
export function estatusCuentaParaIntegracion(estatus: ResumenEstatus): boolean {
  return ESTATUS_CUENTA_INTEGRACION.has(estatus);
}

export function countIntegrationDocsPresentes(
  resumen: IntegrationDocsResumenInput,
): number {
  const byTipo = new Map(resumen.map((r) => [r.tipo_documento, r.estatus_revision]));
  let count = 0;
  for (const tipo of INTEGRATION_DOC_TIPOS_ASESOR_ENVIO) {
    const estatus = byTipo.get(tipo);
    if (estatus && estatusCuentaParaIntegracion(estatus)) {
      count += 1;
    }
  }
  return count;
}

export function integrationDocsCompletos(resumen: IntegrationDocsResumenInput): boolean {
  return (
    countIntegrationDocsPresentes(resumen) ===
    INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length
  );
}

function mapChecklistItems(
  tipos: readonly IntegrationDocAsesorUploadTipo[],
  resumen: IntegrationDocsResumenInput,
  opcional: boolean,
): IntegrationDocChecklistItem[] {
  const byTipo = new Map(resumen.map((r) => [r.tipo_documento, r.estatus_revision]));

  return tipos.map((tipo) => {
    const estatus_revision = byTipo.get(tipo) ?? "faltante";
    return {
      tipo_documento: tipo,
      label: DOCUMENTO_CATALOGO_MAP[tipo].label,
      estatus_revision,
      completo: estatusCuentaParaIntegracion(estatus_revision),
      opcional,
    };
  });
}

/** Checklist de documentos obligatorios para envío a Mesa (5). */
export function deriveIntegrationDocsChecklist(
  resumen: IntegrationDocsResumenInput,
): IntegrationDocChecklistItem[] {
  return mapChecklistItems(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO, resumen, false);
}

/** Checklist de documentos opcionales de upload asesor (no bloquean envío). */
export function deriveIntegrationDocsChecklistOpcionales(
  resumen: IntegrationDocsResumenInput,
): IntegrationDocChecklistItem[] {
  return mapChecklistItems(INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES, resumen, true);
}

/** Adapta `ExpedienteArchivoResumen[]` al input del checklist de integración asesor. */
export function integrationDocsResumenFromArchivoResumen(
  resumen: readonly ExpedienteArchivoResumen[],
): IntegrationDocsResumenInput {
  return resumen.map((r) => ({
    tipo_documento: r.tipo_documento,
    estatus_revision: r.estatus_revision,
  }));
}
