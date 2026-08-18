/**
 * P193 — copy/origen de Cambios por revisar (Mesa).
 * TZ America/Monterrey vía formatMesaAsesorReenviadoAt.
 */

export const MESA_CAMBIO_REVISION_ORIGINS = [
  "REQUESTED_CORRECTION",
  "ADVISOR_UPDATE",
  "AMBIGUOUS",
  "LEGACY",
] as const;

export type MesaCambioRevisionOrigen =
  (typeof MESA_CAMBIO_REVISION_ORIGINS)[number];

export const MESA_CAMBIO_REQUEST_TYPES = [
  "SOLICITUD_DATOS_GENERALES",
  "SOLICITUD_DOCUMENTAL",
  "RECHAZO_OPERATIVO_CON_CORRECCION",
] as const;

export type MesaCambioRequestType = (typeof MESA_CAMBIO_REQUEST_TYPES)[number];

export type MesaCambiosPorRevisarSubfiltro = "todos" | "solicitadas" | "otras";

export const MESA_CAMBIOS_SUBFILTRO_DEFAULT: MesaCambiosPorRevisarSubfiltro =
  "todos";

export function normalizeMesaCambioRevisionOrigen(
  value: string | null | undefined,
): MesaCambioRevisionOrigen | null {
  if (!value) return null;
  return (MESA_CAMBIO_REVISION_ORIGINS as readonly string[]).includes(value)
    ? (value as MesaCambioRevisionOrigen)
    : null;
}

export function normalizeMesaCambioRequestType(
  value: string | null | undefined,
): MesaCambioRequestType | null {
  if (!value) return null;
  return (MESA_CAMBIO_REQUEST_TYPES as readonly string[]).includes(value)
    ? (value as MesaCambioRequestType)
    : null;
}

export function mesaCambioRequestTypeLabel(
  type: MesaCambioRequestType | string | null | undefined,
): string | null {
  if (type === "SOLICITUD_DATOS_GENERALES") return "Datos generales";
  if (type === "SOLICITUD_DOCUMENTAL") return "Documento";
  if (type === "RECHAZO_OPERATIVO_CON_CORRECCION") return "Revisión operativa";
  return null;
}

export function mesaCambioOrigenBadge(origin: MesaCambioRevisionOrigen): string {
  if (origin === "REQUESTED_CORRECTION") return "Corrección solicitada";
  if (origin === "ADVISOR_UPDATE") return "Actualización del asesor";
  if (origin === "AMBIGUOUS") return "Actualización por revisar";
  return "Cambio histórico por revisar";
}

export const MESA_CAMBIO_ESTADO_POR_REVISAR = "Por revisar";

export const MESA_CAMBIO_ADVISOR_COPY =
  "El asesor actualizó el expediente sin una solicitud previa de corrección de Mesa detectada.";

export const MESA_CAMBIO_AMBIGUOUS_COPY =
  "No se pudo determinar de forma inequívoca si este cambio provino de una solicitud previa de Mesa.";

export const MESA_CAMBIO_LEGACY_COPY =
  "No hay información suficiente para clasificar el origen de este cambio histórico.";

export function mesaAsesorCambiosLoteVacioTitulo(
  origin: MesaCambioRevisionOrigen | null | undefined,
): string {
  if (origin === "REQUESTED_CORRECTION") {
    return "Corrección reenviada sin detalle de cambios disponible";
  }
  if (origin === "ADVISOR_UPDATE") {
    return "Actualización enviada sin detalle de cambios disponible";
  }
  if (origin === "AMBIGUOUS") {
    return "Cambio enviado sin detalle de cambios disponible";
  }
  if (origin === "LEGACY") {
    return "Cambio histórico por revisar";
  }
  return "Actualización enviada sin detalle de cambios disponible";
}

export function mesaAsesorCambiosLoteVacioAviso(
  origin: MesaCambioRevisionOrigen | null | undefined,
): string {
  if (origin === "REQUESTED_CORRECTION") {
    return "El asesor reenvió el expediente. No hay detalle de cambios disponible.";
  }
  if (origin === "ADVISOR_UPDATE") {
    return "El asesor actualizó el expediente. No hay detalle de cambios disponible.";
  }
  if (origin === "AMBIGUOUS") {
    return "Hay un cambio pendiente de revisión. No hay detalle de cambios disponible.";
  }
  return "No hay información suficiente para clasificar el origen de este cambio histórico.";
}

export function matchesMesaCambiosSubfiltro(
  origin: MesaCambioRevisionOrigen | null | undefined,
  subfiltro: MesaCambiosPorRevisarSubfiltro,
): boolean {
  if (subfiltro === "todos") return true;
  if (subfiltro === "solicitadas") return origin === "REQUESTED_CORRECTION";
  return origin !== "REQUESTED_CORRECTION";
}

export const MESA_CAMBIOS_SUBFILTRO_LABELS: Readonly<
  Record<MesaCambiosPorRevisarSubfiltro, string>
> = {
  todos: "Todos",
  solicitadas: "Correcciones solicitadas",
  otras: "Otras actualizaciones",
};

export function mapMesaCambiosSubfiltroToRpc(
  quickFilter: string,
  subfiltro: MesaCambiosPorRevisarSubfiltro,
): string {
  if (quickFilter !== "correccion_enviada") return quickFilter;
  if (subfiltro === "solicitadas") return "correccion_solicitada";
  if (subfiltro === "otras") return "otras_actualizaciones";
  return "correccion_enviada";
}

export function mesaCambioDocumentacionLabel(
  origin: MesaCambioRevisionOrigen | null | undefined,
): string {
  return origin ? mesaCambioOrigenBadge(origin) : "Corrección enviada";
}

export function mesaCambioMuestraEstadoPorRevisar(
  origin: MesaCambioRevisionOrigen | null | undefined,
): boolean {
  return origin === "REQUESTED_CORRECTION" || origin === "ADVISOR_UPDATE";
}

export function mesaCambioFechaLoteLabel(
  origin: MesaCambioRevisionOrigen | null | undefined,
): string {
  if (origin === "ADVISOR_UPDATE") return "Actualizada por el asesor";
  if (origin === "REQUESTED_CORRECTION") return "Reenviada por el asesor";
  return "Enviada por el asesor";
}
