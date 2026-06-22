import {
  DOCUMENTO_CATALOGO_MAP,
  type ExpedienteArchivoResumen,
  type ResumenEstatus,
  type TipoDocumentoCatalogo,
} from "./types";

/**
 * Espejo de `integration_doc_tipos_obligatorios()` en `005_rpc_enviar_a_mesa.sql`.
 * Orden fijo para checklist UI y conteo.
 */
export const INTEGRATION_DOC_TIPOS_OBLIGATORIOS = [
  "ine",
  "estado_cuenta",
  "nss",
  "direccion",
  "cliente_ine_frente",
  "cliente_ine_reverso",
  "cliente_comprobante_domicilio",
  "cliente_estado_cuenta",
  "cliente_acta_nacimiento",
  "cliente_constancia_sat",
] as const;

export type IntegrationDocTipo = (typeof INTEGRATION_DOC_TIPOS_OBLIGATORIOS)[number];

const ESTATUS_CUENTA_INTEGRACION = new Set<ResumenEstatus>([
  "subido",
  "resubido",
  "validado",
]);

export type IntegrationDocChecklistItem = {
  tipo_documento: IntegrationDocTipo;
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
  for (const tipo of INTEGRATION_DOC_TIPOS_OBLIGATORIOS) {
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
    INTEGRATION_DOC_TIPOS_OBLIGATORIOS.length
  );
}

export function deriveIntegrationDocsChecklist(
  resumen: IntegrationDocsResumenInput,
): IntegrationDocChecklistItem[] {
  const byTipo = new Map(resumen.map((r) => [r.tipo_documento, r.estatus_revision]));

  return INTEGRATION_DOC_TIPOS_OBLIGATORIOS.map((tipo) => {
    const estatus_revision = byTipo.get(tipo) ?? "faltante";
    return {
      tipo_documento: tipo,
      label: DOCUMENTO_CATALOGO_MAP[tipo].label,
      estatus_revision,
      completo: estatusCuentaParaIntegracion(estatus_revision),
    };
  });
}

/** Adapta `ExpedienteArchivoResumen[]` al input del checklist de integración. */
export function integrationDocsResumenFromArchivoResumen(
  resumen: readonly ExpedienteArchivoResumen[],
): IntegrationDocsResumenInput {
  return resumen.map((r) => ({
    tipo_documento: r.tipo_documento,
    estatus_revision: r.estatus_revision,
  }));
}
