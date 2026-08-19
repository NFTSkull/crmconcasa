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

export type MesaEventoAccionableKind =
  | "nuevo"
  | "correccion"
  | "actualizacion"
  | "espera";

function formatHaceRelativo(
  prefix: string,
  iso: string,
  now: Date,
): string | null {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return null;
  const diffMs = now.getTime() - start.getTime();
  if (diffMs < 0) return `${prefix} hace un momento`;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return `${prefix} hace un momento`;
  if (minutes < 60) {
    return minutes === 1 ? `${prefix} hace 1 min` : `${prefix} hace ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? `${prefix} hace 1 h` : `${prefix} hace ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) return `${prefix} hace 1 día`;
  return `${prefix} hace ${days} días`;
}

export function mesaEventoAccionableKindFromEstado(
  revisionEstado: string | null | undefined,
): MesaEventoAccionableKind {
  if (revisionEstado === "CORRECTION_PENDING_REVIEW") return "correccion";
  if (revisionEstado === "ADVISOR_UPDATE_PENDING_REVIEW") return "actualizacion";
  if (revisionEstado === "WAITING_ADVISOR") return "espera";
  return "nuevo";
}

/** Antigüedad del evento accionable actual (P198). */
export function formatMesaEventoAccionableHaceLabel(
  iso: string | null | undefined,
  kind: MesaEventoAccionableKind,
  now: Date = new Date(),
): string | null {
  const raw = typeof iso === "string" ? iso.trim() : "";
  if (!raw) return null;
  const prefix =
    kind === "correccion"
      ? "Corrección recibida"
      : kind === "actualizacion"
        ? "Actualización recibida"
        : kind === "espera"
          ? "Esperando al asesor"
          : "En Mesa";
  return formatHaceRelativo(prefix, raw, now);
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
  return formatHaceRelativo("En Mesa", raw, now);
}
