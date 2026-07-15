import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos/types";
import type { MesaOpsFilter } from "@/lib/mesaOpsUi";

/**
 * Filtros de la bandeja de Mesa de control (`/mesa-control`).
 *
 * Reglas de producto:
 * - Los chips de "Vista rápida" son accesos directos completos: al seleccionar uno,
 *   la asignación operativa cambia automáticamente a "Todo Mesa" para que la lista
 *   coincida con el contador global del chip.
 * - Los chips de "Asignación operativa" regresan la vista rápida a "Todos" para que
 *   nunca queden dos filtros principales intersectándose de forma silenciosa.
 * - El chip "Citas hoy" no filtra la bandeja: navega a la pantalla de citas
 *   (`MESA_CITAS_ROUTE`), la misma que abre la acción "Ver citas".
 * - Contador y lista comparten exactamente los mismos predicados de este módulo.
 *
 * La bandeja de Mesa carga el conjunto completo visible (RLS + rol) sin paginación,
 * por lo que estos filtros se aplican en memoria sobre la totalidad de expedientes
 * visibles, nunca sobre una página parcial.
 */

/** Chips de Vista rápida que sí filtran la bandeja. */
export type MesaQuickFilter =
  | "todos"
  | "correccion_enviada"
  | "nuevos"
  | "en_proceso"
  | "rechazados";

/** Identificador del chip "Citas hoy": navega, no filtra. */
export const MESA_CITAS_HOY_CHIP_ID = "citas_hoy" as const;

/** Ruta real de la pantalla de citas de Mesa (la misma de "Ver citas"). */
export const MESA_CITAS_ROUTE = "/mesa-control/citas";

export type MesaBandejaFiltroItem = Readonly<{
  cliente_nombre: string;
  telefono_cliente: string;
  etapaActual: number;
  subestado: string;
  fechaCita?: string | null;
  resumenDocumental?: CategoriaResumenDocumental | null;
}>;

export type MesaBandejaFiltrosState = Readonly<{
  quickFilter: MesaQuickFilter;
  buscar: string;
  etapa: string;
  subestado: string;
  soloCitasHoy: boolean;
}>;

/** Selección principal (vista rápida + asignación) tras una interacción. */
export type MesaBandejaSeleccionPrincipal = Readonly<{
  quickFilter: MesaQuickFilter;
  opsFilter: MesaOpsFilter;
}>;

/** Al elegir un chip de Vista rápida, la asignación pasa a "Todo Mesa". */
export function seleccionarVistaRapida(
  id: MesaQuickFilter,
): MesaBandejaSeleccionPrincipal {
  return { quickFilter: id, opsFilter: "todo_mesa" };
}

/** Al elegir un chip de Asignación operativa, la vista rápida vuelve a "Todos". */
export function seleccionarAsignacion(
  id: MesaOpsFilter,
): MesaBandejaSeleccionPrincipal {
  return { quickFilter: "todos", opsFilter: id };
}

/**
 * Estado tras "Limpiar filtros": muestra toda la bandeja visible.
 * Decisión de producto: asignación queda en "Todo Mesa" (no en el default
 * "Disponibles") para que la limpieza deje visible el conjunto completo.
 */
export function limpiarFiltrosBandeja(): MesaBandejaFiltrosState &
  Readonly<{ opsFilter: MesaOpsFilter }> {
  return {
    quickFilter: "todos",
    opsFilter: "todo_mesa",
    buscar: "",
    etapa: "todas",
    subestado: "todas",
    soloCitasHoy: false,
  };
}

/** Convierte fecha ISO o `YYYY-MM-DD` a `YYYY-MM-DD` en horario local. */
export function toYMDLocal(iso?: string | null): string | null {
  if (!iso) return null;
  const trimmed = iso.trim();
  // Las fechas de cita sin hora ya vienen como día calendario; convertirlas vía
  // Date las interpretaría como UTC y podría regresar el día anterior en MX.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function esCitaHoy(
  fechaCita: string | null | undefined,
  todayYMD: string,
): boolean {
  return toYMDLocal(fechaCita) === todayYMD;
}

/** Expediente "nuevo por revisar": etapas 1–2 y subestado operativo activo. */
export function esNuevoEtapa12(
  item: Pick<MesaBandejaFiltroItem, "etapaActual" | "subestado">,
): boolean {
  const et = Number(item.etapaActual) || 0;
  const sub = String(item.subestado || "pendiente");
  return (
    [1, 2].includes(et) &&
    ["pendiente", "en_validacion_mesa", "en_proceso"].includes(sub)
  );
}

/** Predicado único por chip; usarlo tanto en contadores como en la lista. */
export function matchesMesaQuickFilter(
  item: MesaBandejaFiltroItem,
  filter: MesaQuickFilter,
): boolean {
  switch (filter) {
    case "todos":
      return true;
    case "correccion_enviada":
      return item.resumenDocumental === "correccion_enviada";
    case "nuevos":
      return esNuevoEtapa12(item);
    case "en_proceso":
      return item.subestado === "en_proceso";
    case "rechazados":
      return item.subestado === "rechazado";
  }
}

export function soloDigitos(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Búsqueda por nombre (case-insensitive) o teléfono (dígitos normalizados):
 * "81 1234 5678" y "8112345678" encuentran el mismo registro.
 * Cadena vacía o solo espacios no filtra.
 */
export function coincideBusquedaClienteTelefono(
  item: Pick<MesaBandejaFiltroItem, "cliente_nombre" | "telefono_cliente">,
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  if (item.cliente_nombre.toLowerCase().includes(q.toLowerCase())) return true;
  const qDigits = soloDigitos(q);
  if (!qDigits) return false;
  return soloDigitos(item.telefono_cliente).includes(qDigits);
}

export type MesaVistaRapidaCounts = Readonly<{
  correccionesEnviadas: number;
  nuevos: number;
  enProceso: number;
  citasHoy: number;
  rechazados: number;
}>;

/** Contadores globales de Vista rápida; misma definición que la lista filtrada. */
export function contarVistaRapida(
  items: readonly MesaBandejaFiltroItem[],
  todayYMD: string,
): MesaVistaRapidaCounts {
  return {
    correccionesEnviadas: items.filter((c) =>
      matchesMesaQuickFilter(c, "correccion_enviada"),
    ).length,
    nuevos: items.filter((c) => matchesMesaQuickFilter(c, "nuevos")).length,
    enProceso: items.filter((c) => matchesMesaQuickFilter(c, "en_proceso")).length,
    citasHoy: items.filter((c) => esCitaHoy(c.fechaCita, todayYMD)).length,
    rechazados: items.filter((c) => matchesMesaQuickFilter(c, "rechazados")).length,
  };
}

/**
 * Aplica en orden: vista rápida → búsqueda → etapa → subestado → solo citas hoy.
 * Opera sobre el conjunto completo visible; el filtro de asignación operativa y
 * el ordenamiento se aplican después con `applyMesaOpsFilterSorted`.
 */
export function aplicarFiltrosBandejaMesa<T extends MesaBandejaFiltroItem>(
  items: readonly T[],
  state: MesaBandejaFiltrosState,
  todayYMD: string,
): T[] {
  let list = items.filter((c) => matchesMesaQuickFilter(c, state.quickFilter));
  if (state.buscar.trim()) {
    list = list.filter((c) => coincideBusquedaClienteTelefono(c, state.buscar));
  }
  if (state.etapa !== "todas") {
    const etapa = Number(state.etapa);
    list = list.filter((c) => c.etapaActual === etapa);
  }
  if (state.subestado !== "todas") {
    list = list.filter((c) => c.subestado === state.subestado);
  }
  if (state.soloCitasHoy) {
    list = list.filter((c) => esCitaHoy(c.fechaCita, todayYMD));
  }
  return list;
}
