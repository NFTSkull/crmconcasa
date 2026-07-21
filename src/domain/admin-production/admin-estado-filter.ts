/**
 * Predicados de filtro Estado en Admin producción (P094).
 * Rechazados ≠ Cancelados: señales disjuntas (paridad SQL 091).
 */

export type AdminEstadoFilterValue =
  | "todos"
  | "activos"
  | "finalizados"
  | "rechazados"
  | "cancelados";

export type AdminEstadoRow = {
  cicloEstado: string;
  subestado: string;
  etapaActual: number;
};

/** Rechazo canónico recuperable: subestado rechazado y ciclo activo. */
export function esAdminRechazadoOperativo(row: AdminEstadoRow): boolean {
  return row.subestado === "rechazado" && row.cicloEstado === "activo";
}

export function esAdminCanceladoOperativo(row: AdminEstadoRow): boolean {
  return row.cicloEstado === "cancelado";
}

export function matchesAdminEstadoFilter(
  row: AdminEstadoRow,
  estado: AdminEstadoFilterValue | null | undefined,
): boolean {
  if (!estado || estado === "todos") return true;
  if (estado === "activos") {
    return row.cicloEstado === "activo" && row.subestado !== "rechazado";
  }
  if (estado === "finalizados") {
    return row.cicloEstado === "cerrado" || row.etapaActual >= 11;
  }
  if (estado === "rechazados") {
    return esAdminRechazadoOperativo(row);
  }
  if (estado === "cancelados") {
    return esAdminCanceladoOperativo(row);
  }
  return true;
}

/** Mapeo directo a `p_estado` de RPCs Admin (091+). */
export function adminEstadoRpcParam(
  estado: AdminEstadoFilterValue | null | undefined,
): string | null {
  if (!estado || estado === "todos") return null;
  return estado;
}
