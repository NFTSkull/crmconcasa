/**
 * Admin UX B1 — helpers puros para la navegación por pestañas del panel Admin.
 * Solo UX/UI: no toca consultas, filtros ni lógica de negocio.
 */

/** Pestañas principales del panel (B1). Bernardo es vista aparte (B3). */
export type AdminMainTabId =
  | "resumen"
  | "expedientes"
  | "reportes"
  | "produccion";

/** Incluye vista Bernardo (`?adminTab=bernardo`) sin meterla en el tablist. */
export type AdminTabId = AdminMainTabId | "bernardo";

export type AdminTabDef = {
  readonly id: AdminMainTabId;
  readonly label: string;
  /** Descripción corta mostrada como subtítulo del módulo. */
  readonly description: string;
};

export const ADMIN_TABS: readonly AdminTabDef[] = [
  {
    id: "resumen",
    label: "Resumen",
    description:
      "KPIs del periodo y estado actual de los expedientes por etapa.",
  },
  {
    id: "expedientes",
    label: "Expedientes",
    description:
      "Flujo operativo de Mesa y precalificaciones, con búsqueda y filtros.",
  },
  {
    id: "reportes",
    label: "Reportes",
    description: "Histórico por etapas e ingresos.",
  },
  {
    id: "produccion",
    label: "Producción",
    description: "Producción por asesor durante el periodo seleccionado.",
  },
];

export const DEFAULT_ADMIN_TAB: AdminMainTabId = "resumen";

/** Query param visual para conservar la pestaña al refrescar. */
export const ADMIN_TAB_QUERY_PARAM = "adminTab";

export function isAdminMainTabId(value: unknown): value is AdminMainTabId {
  return (
    typeof value === "string" &&
    ADMIN_TABS.some((t) => t.id === value)
  );
}

export function isAdminTabId(value: unknown): value is AdminTabId {
  return isAdminMainTabId(value) || value === "bernardo";
}

export function isAdminBernardoView(tab: AdminTabId): boolean {
  return tab === "bernardo";
}

/** Valor inválido o ausente → pestaña por defecto (Resumen). */
export function parseAdminTabParam(
  value: string | null | undefined,
): AdminTabId {
  return isAdminTabId(value) ? value : DEFAULT_ADMIN_TAB;
}

export function adminTabButtonId(id: AdminTabId): string {
  return `admin-tab-${id}`;
}

export function adminTabPanelId(id: AdminTabId): string {
  return `admin-tabpanel-${id}`;
}

/**
 * Navegación por teclado del tablist (patrón WAI-ARIA):
 * flechas izquierda/derecha con wrap, Home y End. Otra tecla → null.
 */
export function nextAdminTabIdOnKey(
  current: AdminMainTabId,
  key: string,
): AdminMainTabId | null {
  const ids = ADMIN_TABS.map((t) => t.id);
  const idx = ids.indexOf(current);
  if (idx < 0) return null;
  switch (key) {
    case "ArrowRight":
      return ids[(idx + 1) % ids.length]!;
    case "ArrowLeft":
      return ids[(idx - 1 + ids.length) % ids.length]!;
    case "Home":
      return ids[0]!;
    case "End":
      return ids[ids.length - 1]!;
    default:
      return null;
  }
}

/**
 * La barra de filtros globales (periodo/asesor/etapa/estado/buscar) aplica a
 * Resumen, Expedientes y Producción. Reportes e Ingresos conservan sus filtros
 * propios; Bernardo tiene periodo propio — ahí la barra se oculta.
 */
export function adminGlobalFiltersVisible(tab: AdminTabId): boolean {
  return tab !== "reportes" && tab !== "bernardo";
}

// --- Subtabs de Reportes -----------------------------------------------------
// Histórico e ingresos: el detalle de resultado por etapa sigue en el reporte
// histórico (P149/P153) sin exponer jerga técnica en la UI.

export type AdminReportesSubtabId = "historico" | "ingresos";

export const ADMIN_REPORTES_SUBTABS: readonly {
  readonly id: AdminReportesSubtabId;
  readonly label: string;
}[] = [
  { id: "historico", label: "Histórico por etapas" },
  { id: "ingresos", label: "Ingresos" },
];

export const DEFAULT_ADMIN_REPORTES_SUBTAB: AdminReportesSubtabId = "historico";

export function isAdminReportesSubtabId(
  value: unknown,
): value is AdminReportesSubtabId {
  return (
    typeof value === "string" &&
    ADMIN_REPORTES_SUBTABS.some((t) => t.id === value)
  );
}

export function parseAdminReportesSubtab(
  value: string | null | undefined,
): AdminReportesSubtabId {
  return isAdminReportesSubtabId(value) ? value : DEFAULT_ADMIN_REPORTES_SUBTAB;
}
