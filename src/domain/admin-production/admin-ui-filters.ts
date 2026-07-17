/** Helpers puros de UI Admin (navegación etapa / foco) — testeables sin React. */

/** Toggle de tarjeta de etapa: misma etapa activa → "todas"; si no → String(etapa). */
export function nextEtapaFilterFromCard(
  currentEtapaFilter: string,
  pressedEtapa: number,
): string {
  const next = String(pressedEtapa);
  return currentEtapaFilter === next ? "todas" : next;
}

/** Tras aplicar etapa, la página de expedientes debe reiniciarse a 1. */
export function mesaPageAfterEtapaChange(): number {
  return 1;
}

/** Ambas paginaciones al cambiar asesor. */
export function pagesAfterAsesorChange(): { mesaPage: number; precalPage: number } {
  return { mesaPage: 1, precalPage: 1 };
}
