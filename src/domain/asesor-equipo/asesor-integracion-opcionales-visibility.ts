/**
 * Visibilidad de opcionales de integración asesor.
 * Autoridad: `asesor_es_paquete_documental_externos` (actor JWT).
 *
 * - unresolved: ocultar extras (evita flash / upload denegado)
 * - externo confirmado: Acta digital + Semanas cotizadas en checklist
 *   (opcionales; no bloquean envío). Constancia SAT y Vigencia = secciones dedicadas.
 * - interno confirmado: todos los opcionales históricos del checklist
 *
 * Evidencia dedicada: solo internos (`shouldMountAsesorIntegracionOpcionalDedicado`).
 * Vigencia dedicada: internos y externos (`shouldMountAsesorVigenciaDerechosForActor`).
 * Constancia SAT: internos y externos (`shouldMountAsesorConstanciaSituacionFiscalForActor`).
 */
export type AsesorIntegracionOpcionalesVisibility =
  | "hide"
  | "show_internos"
  | "show_externos_checklist";

/** Opcionales de integración en checklist para externos (SQL upload_para). */
export const INTEGRATION_DOC_TIPO_ACTA_DIGITAL_EXTERNO =
  "cliente_acta_nacimiento_digital" as const;

export const INTEGRATION_DOC_TIPO_SEMANAS_COTIZADAS =
  "cliente_semanas_cotizadas" as const;

/** Constancia SAT asesor (no Mesa `cliente_constancia_sat`); opcional en upload externos. */
export const INTEGRATION_DOC_TIPO_CONSTANCIA_SAT_ASESOR =
  "cliente_constancia_situacion_fiscal" as const;

/** Tipos del checklist opcional visibles para externos confirmados. */
export const INTEGRATION_DOC_TIPOS_CHECKLIST_EXTERNOS = [
  INTEGRATION_DOC_TIPO_ACTA_DIGITAL_EXTERNO,
  INTEGRATION_DOC_TIPO_SEMANAS_COTIZADAS,
] as const;

export function resolveAsesorIntegracionOpcionalesVisibility(
  actorPaqueteExternos: boolean | null | undefined,
  actorPaqueteResolved: boolean,
): AsesorIntegracionOpcionalesVisibility {
  if (!actorPaqueteResolved) return "hide";
  if (actorPaqueteExternos === true) return "show_externos_checklist";
  return "show_internos";
}

/** Montar Evidencia (y extras internos dedicados): solo internos. */
export function shouldMountAsesorIntegracionOpcionalDedicado(params: Readonly<{
  actorPaqueteExternos: boolean | null | undefined;
  actorPaqueteResolved: boolean;
}>): boolean {
  return (
    resolveAsesorIntegracionOpcionalesVisibility(
      params.actorPaqueteExternos,
      params.actorPaqueteResolved,
    ) === "show_internos"
  );
}

/**
 * Vigencia de derechos (sección dedicada, MIME amplio):
 * internos y externos confirmados. Unresolved → false.
 * No reutiliza el helper de Evidencia.
 */
export function shouldMountAsesorVigenciaDerechosForActor(params: Readonly<{
  actorPaqueteExternos: boolean | null | undefined;
  actorPaqueteResolved: boolean;
}>): boolean {
  if (!params.actorPaqueteResolved) return false;
  return params.actorPaqueteExternos === true || params.actorPaqueteExternos === false;
}

/**
 * Constancia SAT (sección dedicada): internos y externos confirmados.
 * Unresolved → false (fail-safe; evita UI que backend aún rechace).
 */
export function shouldMountAsesorConstanciaSituacionFiscalForActor(params: Readonly<{
  actorPaqueteExternos: boolean | null | undefined;
  actorPaqueteResolved: boolean;
}>): boolean {
  if (!params.actorPaqueteResolved) return false;
  // Interno o externo confirmado.
  return params.actorPaqueteExternos === true || params.actorPaqueteExternos === false;
}

type ChecklistItemConTipo = { tipo_documento: string };

/**
 * Filtra checklist de opcionales de integración según actor.
 * Externo → Acta digital + Semanas. Interno → lista completa. Unresolved → [].
 * Vigencia y Constancia SAT no van aquí (secciones dedicadas).
 */
export function filterIntegracionChecklistOpcionalesParaActor<
  T extends ChecklistItemConTipo,
>(
  items: readonly T[],
  params: Readonly<{
    actorPaqueteExternos: boolean | null | undefined;
    actorPaqueteResolved: boolean;
  }>,
): T[] {
  const mode = resolveAsesorIntegracionOpcionalesVisibility(
    params.actorPaqueteExternos,
    params.actorPaqueteResolved,
  );
  if (mode === "hide") return [];
  if (mode === "show_externos_checklist") {
    const allow = new Set<string>(INTEGRATION_DOC_TIPOS_CHECKLIST_EXTERNOS);
    return items.filter((i) => allow.has(i.tipo_documento));
  }
  return [...items];
}
