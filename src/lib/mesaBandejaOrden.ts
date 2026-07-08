/** Item mínimo para ordenar bandeja Mesa por antigüedad de envío. */
export type MesaBandejaOrdenItem = Readonly<{
  fechaEnvioMesa?: string | null;
  /** Fecha efectiva (última corrección o primer envío); prioriza sobre `fechaEnvioMesa`. */
  fechaEntradaMesaActual?: string | null;
  createdAt?: string | null;
}>;

/**
 * Timestamp de entrada a Mesa para ordenar.
 * `fechaEntradaMesaActual` o `fecha_envio_mesa`; `createdAt` solo como fallback mock.
 * Sin fecha válida → al final de la lista.
 */
export function getMesaEnvioSortTimestamp(item: MesaBandejaOrdenItem): number {
  const efectiva =
    typeof item.fechaEntradaMesaActual === "string"
      ? item.fechaEntradaMesaActual.trim()
      : "";
  const raw =
    efectiva ||
    (typeof item.fechaEnvioMesa === "string" && item.fechaEnvioMesa.trim()) ||
    (typeof item.createdAt === "string" && item.createdAt.trim()) ||
    "";
  if (!raw) return Number.POSITIVE_INFINITY;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Más antiguos primero (`fecha_envio_mesa ASC`). */
export function sortMesaBandejaPorAntiguedad<T extends MesaBandejaOrdenItem>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) => getMesaEnvioSortTimestamp(a) - getMesaEnvioSortTimestamp(b),
  );
}

/** ISO de envío a Mesa; `createdAt` solo como fallback mock. */
export function resolveMesaEnvioIso(
  fechaEnvioMesa: string | null | undefined,
  createdAt?: string | null,
): string | null {
  const fromEnvio =
    typeof fechaEnvioMesa === "string" ? fechaEnvioMesa.trim() : "";
  if (fromEnvio) return fromEnvio;
  const fromCreated =
    typeof createdAt === "string" ? createdAt.trim() : "";
  return fromCreated || null;
}

/**
 * Etiqueta relativa para badge en tarjeta de bandeja.
 * Ej.: «En Mesa hace 4 h», «En Mesa hace 2 días».
 */
export function formatEnMesaHaceLabel(
  fechaEnvioMesa: string | null | undefined,
  now: Date = new Date(),
  createdAt?: string | null,
  fechaEntradaMesaActual?: string | null,
): string | null {
  const efectiva =
    typeof fechaEntradaMesaActual === "string" ? fechaEntradaMesaActual.trim() : "";
  const raw = efectiva || resolveMesaEnvioIso(fechaEnvioMesa, createdAt);
  if (!raw) return null;

  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return null;

  const diffMs = now.getTime() - start.getTime();
  if (diffMs < 0) return "En Mesa hace un momento";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "En Mesa hace un momento";
  if (minutes < 60) {
    return minutes === 1 ? "En Mesa hace 1 min" : `En Mesa hace ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? "En Mesa hace 1 h" : `En Mesa hace ${hours} h`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) return "En Mesa hace 1 día";
  return `En Mesa hace ${days} días`;
}
