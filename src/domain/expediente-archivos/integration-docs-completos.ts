import { DOCUMENTO_CATALOGO_MAP } from "./types";
import * as Impl from "./integration-docs-completos.impl";

export * from "./integration-docs-completos.impl";

type IntegrationResumen = Parameters<typeof Impl.countIntegrationDocsPresentes>[0];
type ChecklistItem = ReturnType<typeof Impl.deriveIntegrationDocsChecklist>[number];

const SEMANAS = "cliente_semanas_cotizadas" as const;
const VIGENCIA = "cliente_vigencia_derechos" as const;
const ESTADO_CUENTA = "cliente_estado_cuenta" as const;

function resumenMap(resumen: IntegrationResumen) {
  return new Map(resumen.map((r) => [r.tipo_documento, r.estatus_revision]));
}

/**
 * Para el paquete Silvia, el slot técnico `cliente_semanas_cotizadas` se
 * considera cubierto por Semanas cotizadas O Vigencia de derechos.
 * Fuera de ese slot la semántica permanece idéntica al contrato histórico.
 */
function statusParaTipo(
  resumen: IntegrationResumen,
  tipo: string,
): ChecklistItem["estatus_revision"] {
  const byTipo = resumenMap(resumen);
  if (tipo !== SEMANAS) {
    return byTipo.get(tipo) ?? "faltante";
  }

  const semanas = byTipo.get(SEMANAS) ?? "faltante";
  const vigencia = byTipo.get(VIGENCIA) ?? "faltante";

  if (Impl.estatusCuentaParaIntegracion(semanas)) return semanas;
  if (Impl.estatusCuentaParaIntegracion(vigencia)) return vigencia;
  if (semanas === "rechazado") return semanas;
  if (vigencia === "rechazado") return vigencia;
  return "faltante";
}

export function deriveIntegrationDocsChecklist(
  resumen: IntegrationResumen,
  tipos: readonly string[] = Impl.INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
): ChecklistItem[] {
  return tipos.map((tipo) => {
    const estatus_revision = statusParaTipo(resumen, tipo);
    return {
      tipo_documento: tipo as ChecklistItem["tipo_documento"],
      label: DOCUMENTO_CATALOGO_MAP[tipo as keyof typeof DOCUMENTO_CATALOGO_MAP].label,
      estatus_revision,
      completo: Impl.estatusCuentaParaIntegracion(estatus_revision),
      opcional: false,
    };
  });
}

export function countIntegrationDocsPresentes(
  resumen: IntegrationResumen,
  tipos: readonly string[] = Impl.INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
): number {
  return deriveIntegrationDocsChecklist(resumen, tipos).filter((x) => x.completo).length;
}

export function integrationDocsCompletos(
  resumen: IntegrationResumen,
  tipos: readonly string[] = Impl.INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
): boolean {
  return countIntegrationDocsPresentes(resumen, tipos) === tipos.length;
}

export function countIntegrationDocsValidados(
  resumen: IntegrationResumen,
  tipos: readonly string[] = Impl.INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
): number {
  const byTipo = resumenMap(resumen);
  let count = 0;
  for (const tipo of tipos) {
    if (tipo === SEMANAS) {
      if (byTipo.get(SEMANAS) === "validado" || byTipo.get(VIGENCIA) === "validado") {
        count += 1;
      }
      continue;
    }
    if (byTipo.get(tipo) === "validado") count += 1;
  }
  return count;
}

export function integrationDocsTodosValidados(
  resumen: IntegrationResumen,
  tipos: readonly string[] = Impl.INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
): boolean {
  return countIntegrationDocsValidados(resumen, tipos) === tipos.length;
}

/**
 * Estado de cuenta sigue obligatorio para los paquetes históricos que lo
 * incluyen en `tiposEnvioObligatorios`; para Silvia queda disponible como
 * opcional. El wrapper de UI deduplica cualquier tipo que ya venga obligatorio,
 * por lo que internos/Anette/Orlando no cambian visualmente.
 */
export function deriveIntegrationDocsChecklistOpcionales(
  resumen: IntegrationResumen,
): ChecklistItem[] {
  const base = Impl.deriveIntegrationDocsChecklistOpcionales(resumen);
  if (base.some((x) => x.tipo_documento === ESTADO_CUENTA)) return base;

  const estatus_revision = statusParaTipo(resumen, ESTADO_CUENTA);
  return [
    ...base,
    {
      tipo_documento: ESTADO_CUENTA as ChecklistItem["tipo_documento"],
      label: DOCUMENTO_CATALOGO_MAP[ESTADO_CUENTA].label,
      estatus_revision,
      completo: Impl.estatusCuentaParaIntegracion(estatus_revision),
      opcional: true,
    },
  ];
}
