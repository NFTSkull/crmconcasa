/**
 * Visibilidad de opcionales de integración asesor.
 * Autoridad: `asesor_es_paquete_documental_externos` (actor JWT).
 *
 * - unresolved: ocultar extras (evita flash / upload denegado)
 * - externo confirmado: Acta de nacimiento digital en checklist (opcional; no bloquea envío)
 * - interno confirmado: todos los opcionales históricos del checklist
 *
 * Secciones dedicadas Evidencia/Vigencia: solo internos.
 * Constancia SAT (`cliente_constancia_situacion_fiscal`): internos y externos
 * (regla propia `shouldMountAsesorConstanciaSituacionFiscalForActor`).
 */
export type AsesorIntegracionOpcionalesVisibility =
  | "hide"
  | "show_internos"
  | "show_externos_acta_only";

/** Opcional de integración en checklist para externos (SQL upload_para). */
export const INTEGRATION_DOC_TIPO_ACTA_DIGITAL_EXTERNO =
  "cliente_acta_nacimiento_digital" as const;

/** Constancia SAT asesor (no Mesa `cliente_constancia_sat`); opcional en upload externos. */
export const INTEGRATION_DOC_TIPO_CONSTANCIA_SAT_ASESOR =
  "cliente_constancia_situacion_fiscal" as const;

export function resolveAsesorIntegracionOpcionalesVisibility(
  actorPaqueteExternos: boolean | null | undefined,
  actorPaqueteResolved: boolean,
): AsesorIntegracionOpcionalesVisibility {
  if (!actorPaqueteResolved) return "hide";
  if (actorPaqueteExternos === true) return "show_externos_acta_only";
  return "show_internos";
}

/** Montar Evidencia / Vigencia (y demás dedicadas restringidas): solo internos. */
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
 * Externo → solo Acta digital. Interno → lista completa. Unresolved → [].
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
  if (mode === "show_externos_acta_only") {
    return items.filter(
      (i) => i.tipo_documento === INTEGRATION_DOC_TIPO_ACTA_DIGITAL_EXTERNO,
    );
  }
  return [...items];
}
