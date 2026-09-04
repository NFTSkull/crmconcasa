/**
 * Visibilidad de opcionales de integración asesor (semanas, carta, acta digital, …).
 * Autoridad: `asesor_es_paquete_documental_externos` (actor JWT).
 *
 * - unresolved: ocultar (evita flash / upload que SQL denegará)
 * - externo confirmado: ocultar
 * - interno confirmado: mostrar (comportamiento histórico)
 */
export type AsesorIntegracionOpcionalesVisibility = "hide" | "show";

export function resolveAsesorIntegracionOpcionalesVisibility(
  actorPaqueteExternos: boolean | null | undefined,
  actorPaqueteResolved: boolean,
): AsesorIntegracionOpcionalesVisibility {
  if (!actorPaqueteResolved) return "hide";
  if (actorPaqueteExternos === true) return "hide";
  return "show";
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
    ) === "show"
  );
}

/**
 * Filtra el checklist de opcionales de integración.
 * Externo / no resuelto → [] (nunca acta digital, carta, semanas, etc.).
 */
export function filterIntegracionChecklistOpcionalesParaActor<T>(
  items: readonly T[],
  params: Readonly<{
    actorPaqueteExternos: boolean | null | undefined;
    actorPaqueteResolved: boolean;
  }>,
): T[] {
  if (
    resolveAsesorIntegracionOpcionalesVisibility(
      params.actorPaqueteExternos,
      params.actorPaqueteResolved,
    ) === "hide"
  ) {
    return [];
  }
  return [...items];
}
