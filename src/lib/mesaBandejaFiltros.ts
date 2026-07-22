import type { CategoriaResumenDocumental } from "@/domain/expediente-archivos/types";
import { etapasInternasParaFiltroPaso } from "@/domain/expedientes/etapa-numeracion-ux";
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
 * - P094: «Todos» / operativos = ciclo activo; cancelados solo vía
 *   «Rechazos y cancelaciones» + subvista Cancelados.
 *
 * P102 (Supabase): estos predicados viven en RPC `mesa_list_bandeja_page`
 * (filtros → orden → página). En mock/legacy siguen aplicándose en memoria
 * sobre el conjunto completo visible.
 */

/** Chips de Vista rápida que sí filtran la bandeja. */
export type MesaQuickFilter =
  | "todos"
  | "correccion_enviada"
  | "nuevos"
  | "en_proceso"
  | "rechazos_cancelaciones";

/** Subvista dentro del chip agrupado P094. */
export type MesaRechazosCancelacionesSubfiltro =
  | "rechazados"
  | "cancelados";

/** Identificador del chip "Citas hoy": navega, no filtra. */
export const MESA_CITAS_HOY_CHIP_ID = "citas_hoy" as const;

/** Ruta real de la pantalla de citas de Mesa (la misma de "Ver citas"). */
export const MESA_CITAS_ROUTE = "/mesa-control/citas";

export type MesaBandejaFiltroItem = Readonly<{
  cliente_nombre: string;
  telefono_cliente: string;
  /** NSS opcional: la búsqueda también lo considera (P102). */
  nss?: string | null;
  etapaActual: number;
  subestado: string;
  /** Ciclo operativo; `null`/`undefined` se tratan como activo (legacy mock). */
  cicloEstado?: string | null;
  fechaCita?: string | null;
  resumenDocumental?: CategoriaResumenDocumental | null;
}>;

export type MesaBandejaFiltrosState = Readonly<{
  quickFilter: MesaQuickFilter;
  /** Solo aplica cuando `quickFilter === "rechazos_cancelaciones"`. */
  rechazosCancelacionesSubfiltro: MesaRechazosCancelacionesSubfiltro;
  buscar: string;
  etapa: string;
  subestado: string;
  soloCitasHoy: boolean;
}>;

/** Selección principal (vista rápida + asignación) tras una interacción. */
export type MesaBandejaSeleccionPrincipal = Readonly<{
  quickFilter: MesaQuickFilter;
  opsFilter: MesaOpsFilter;
  rechazosCancelacionesSubfiltro: MesaRechazosCancelacionesSubfiltro;
}>;

function cicloActivo(
  item: Pick<MesaBandejaFiltroItem, "cicloEstado">,
): boolean {
  const ciclo = item.cicloEstado ?? "activo";
  return ciclo === "activo";
}

/** Rechazado canónico vigente (permite reingreso). */
export function esRechazadoOperativoActivo(
  item: Pick<MesaBandejaFiltroItem, "subestado" | "cicloEstado">,
): boolean {
  return item.subestado === "rechazado" && cicloActivo(item);
}

/** Cancelación terminal. */
export function esCanceladoOperativo(
  item: Pick<MesaBandejaFiltroItem, "cicloEstado">,
): boolean {
  return item.cicloEstado === "cancelado";
}

/** Chip agrupado: rechazados activos + cancelados. */
export function esRechazoOCancelacion(
  item: Pick<MesaBandejaFiltroItem, "subestado" | "cicloEstado">,
): boolean {
  return esRechazadoOperativoActivo(item) || esCanceladoOperativo(item);
}

/** Al elegir un chip de Vista rápida, la asignación pasa a "Todo Mesa". */
export function seleccionarVistaRapida(
  id: MesaQuickFilter,
  subfiltro: MesaRechazosCancelacionesSubfiltro = "rechazados",
): MesaBandejaSeleccionPrincipal {
  return {
    quickFilter: id,
    opsFilter: "todo_mesa",
    rechazosCancelacionesSubfiltro:
      id === "rechazos_cancelaciones" ? subfiltro : "rechazados",
  };
}

/** Al elegir un chip de Asignación operativa, la vista rápida vuelve a "Todos". */
export function seleccionarAsignacion(
  id: MesaOpsFilter,
): MesaBandejaSeleccionPrincipal {
  return {
    quickFilter: "todos",
    opsFilter: id,
    rechazosCancelacionesSubfiltro: "rechazados",
  };
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
    rechazosCancelacionesSubfiltro: "rechazados",
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
  item: Pick<MesaBandejaFiltroItem, "etapaActual" | "subestado" | "cicloEstado">,
): boolean {
  if (!cicloActivo(item) || esCanceladoOperativo(item)) return false;
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
      // Política P094: «Todos» = ciclo activo (cancelados solo vía chip agrupado).
      return cicloActivo(item);
    case "correccion_enviada":
      return (
        cicloActivo(item) && item.resumenDocumental === "correccion_enviada"
      );
    case "nuevos":
      return esNuevoEtapa12(item);
    case "en_proceso":
      return cicloActivo(item) && item.subestado === "en_proceso";
    case "rechazos_cancelaciones":
      return esRechazoOCancelacion(item);
  }
}

export function matchesRechazosCancelacionesSubfiltro(
  item: MesaBandejaFiltroItem,
  subfiltro: MesaRechazosCancelacionesSubfiltro,
): boolean {
  if (subfiltro === "rechazados") return esRechazadoOperativoActivo(item);
  return esCanceladoOperativo(item);
}

export function soloDigitos(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * Búsqueda por nombre (case-insensitive), teléfono (dígitos) o NSS (dígitos/texto).
 * Cadena vacía o solo espacios no filtra.
 */
export function coincideBusquedaClienteTelefono(
  item: Pick<MesaBandejaFiltroItem, "cliente_nombre" | "telefono_cliente" | "nss">,
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  if (item.cliente_nombre.toLowerCase().includes(q.toLowerCase())) return true;
  const qDigits = soloDigitos(q);
  const nssRaw = String(item.nss ?? "");
  if (nssRaw && nssRaw.toLowerCase().includes(q.toLowerCase())) return true;
  if (qDigits && soloDigitos(nssRaw).includes(qDigits)) return true;
  if (!qDigits) return false;
  return soloDigitos(item.telefono_cliente).includes(qDigits);
}

export type MesaVistaRapidaCounts = Readonly<{
  correccionesEnviadas: number;
  nuevos: number;
  enProceso: number;
  citasHoy: number;
  /** Contador del chip agrupado (rechazados activos + cancelados). */
  rechazosCancelaciones: number;
  rechazados: number;
  cancelados: number;
}>;

/** Contadores globales de Vista rápida; misma definición que la lista filtrada. */
export function contarVistaRapida(
  items: readonly MesaBandejaFiltroItem[],
  todayYMD: string,
): MesaVistaRapidaCounts {
  const rechazados = items.filter((c) => esRechazadoOperativoActivo(c)).length;
  const cancelados = items.filter((c) => esCanceladoOperativo(c)).length;
  return {
    correccionesEnviadas: items.filter((c) =>
      matchesMesaQuickFilter(c, "correccion_enviada"),
    ).length,
    nuevos: items.filter((c) => matchesMesaQuickFilter(c, "nuevos")).length,
    enProceso: items.filter((c) => matchesMesaQuickFilter(c, "en_proceso"))
      .length,
    citasHoy: items.filter(
      (c) => cicloActivo(c) && esCitaHoy(c.fechaCita, todayYMD),
    ).length,
    rechazosCancelaciones: items.filter((c) =>
      matchesMesaQuickFilter(c, "rechazos_cancelaciones"),
    ).length,
    rechazados,
    cancelados,
  };
}

/**
 * Aplica en orden: vista rápida → subvista P094 → búsqueda → etapa → subestado → solo citas hoy.
 * Opera sobre el conjunto completo visible; el filtro de asignación operativa y
 * el ordenamiento se aplican después con `applyMesaOpsFilterSorted`.
 */
export function aplicarFiltrosBandejaMesa<T extends MesaBandejaFiltroItem>(
  items: readonly T[],
  state: MesaBandejaFiltrosState,
  todayYMD: string,
): T[] {
  let list = items.filter((c) => matchesMesaQuickFilter(c, state.quickFilter));
  if (state.quickFilter === "rechazos_cancelaciones") {
    list = list.filter((c) =>
      matchesRechazosCancelacionesSubfiltro(
        c,
        state.rechazosCancelacionesSubfiltro,
      ),
    );
  }
  if (state.buscar.trim()) {
    list = list.filter((c) => coincideBusquedaClienteTelefono(c, state.buscar));
  }
  if (state.etapa !== "todas") {
    const etapas = etapasInternasParaFiltroPaso(state.etapa);
    if (etapas && etapas.length > 0) {
      const set = new Set(etapas);
      list = list.filter((c) => set.has(c.etapaActual));
    }
  }
  if (state.subestado !== "todas") {
    list = list.filter((c) => c.subestado === state.subestado);
  }
  if (state.soloCitasHoy) {
    list = list.filter((c) => esCitaHoy(c.fechaCita, todayYMD));
  }
  return list;
}
