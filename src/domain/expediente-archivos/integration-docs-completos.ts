import {
  DOCUMENTO_CATALOGO_MAP,
  type ExpedienteArchivoResumen,
  type ResumenEstatus,
  type TipoDocumentoCatalogo,
} from "./types";

/**
 * Espejo de `integration_doc_tipos_asesor_envio()` (migración 026).
 * Documentos que el asesor debe completar antes de `enviar_a_mesa`.
 */
export const INTEGRATION_DOC_TIPOS_ASESOR_ENVIO = [
  "ine",
  "estado_cuenta",
  "nss",
  "direccion",
  "cliente_ine_frente",
  "cliente_ine_reverso",
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
] as const;

/**
 * Espejo de `integration_doc_tipos_obligatorios()` — validación Mesa (10).
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

export type IntegrationDocTipo = IntegrationDocAsesorEnvioTipo;

const ESTATUS_CUENTA_INTEGRACION = new Set<ResumenEstatus>([
  "subido",
  "resubido",
  "validado",
]);

export type IntegrationDocChecklistItem = {
  tipo_documento: IntegrationDocAsesorEnvioTipo;
  label: string;
  estatus_revision: ResumenEstatus;
  completo: boolean;
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

export function deriveIntegrationDocsChecklist(
  resumen: IntegrationDocsResumenInput,
): IntegrationDocChecklistItem[] {
  const byTipo = new Map(resumen.map((r) => [r.tipo_documento, r.estatus_revision]));

  return INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map((tipo) => {
    const estatus_revision = byTipo.get(tipo) ?? "faltante";
    return {
      tipo_documento: tipo,
      label: DOCUMENTO_CATALOGO_MAP[tipo].label,
      estatus_revision,
      completo: estatusCuentaParaIntegracion(estatus_revision),
    };
  });
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
