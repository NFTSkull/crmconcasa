/**
 * Visibilidad de opcionales de integración asesor.
 * Autoridad: `asesor_es_paquete_documental_externos` (actor JWT).
 *
 * - unresolved: ocultar extras (evita flash / upload denegado)
 * - externo confirmado: SOLO Acta de nacimiento digital (opcional; no bloquea envío)
 * - interno confirmado: todos los opcionales históricos del checklist
 *
 * Secciones dedicadas (Evidencia/Vigencia/Constancia SAT): solo internos.
 */
export type AsesorIntegracionOpcionalesVisibility =
  | "hide"
  | "show_internos"
  | "show_externos_acta_only";

/** Único opcional de integración permitido a externos (SQL upload_para). */
export const INTEGRATION_DOC_TIPO_ACTA_DIGITAL_EXTERNO =
  "cliente_acta_nacimiento_digital" as const;

export function resolveAsesorIntegracionOpcionalesVisibility(
  actorPaqueteExternos: boolean | null | undefined,
  actorPaqueteResolved: boolean,
): AsesorIntegracionOpcionalesVisibility {
  if (!actorPaqueteResolved) return "hide";
  if (actorPaqueteExternos === true) return "show_externos_acta_only";
  return "show_internos";
}

/** Montar secciones dedicadas de opcionales de integración (Evidencia, Vigencia, Constancia SAT, …). */
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
