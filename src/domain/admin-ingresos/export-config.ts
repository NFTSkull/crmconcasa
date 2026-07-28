import type { IngresosFilters, IngresosStageScope } from "./types";

export const INGRESOS_EXPORT_MAX_ROWS = 10_000;

export type IngresosExcelSheetId =
  | "resumen"
  | "detalle"
  | "por_asesor"
  | "por_porcentaje"
  | "por_fuente"
  | "tendencia"
  | "filtros";

export type IngresosExcelColumnId =
  | "cliente"
  | "nss"
  | "asesor"
  | "programa"
  | "etapa_visible"
  | "estado_actual"
  | "fecha_envio_mesa"
  | "fecha_bio"
  | "fecha_pago"
  | "monto_general"
  | "monto_actualizado"
  | "monto_base"
  | "fuente_monto"
  | "porcentaje"
  | "proyectado"
  | "real"
  | "pendiente"
  | "estado_ingreso"
  | "snapshot_estimado"
  | "expediente_id";

export type IngresosExcelExportConfig = Readonly<{
  sheets: readonly IngresosExcelSheetId[];
  columns: readonly IngresosExcelColumnId[];
  reportName: string;
}>;

export const INGRESOS_EXCEL_SHEET_OPTIONS: ReadonlyArray<{
  id: IngresosExcelSheetId;
  label: string;
  defaultOn: boolean;
}> = [
  { id: "resumen", label: "Resumen ejecutivo", defaultOn: true },
  { id: "detalle", label: "Detalle de expedientes", defaultOn: true },
  { id: "por_asesor", label: "Por asesor", defaultOn: false },
  { id: "por_porcentaje", label: "Por porcentaje", defaultOn: false },
  { id: "por_fuente", label: "Por fuente de monto", defaultOn: false },
  { id: "tendencia", label: "Tendencia", defaultOn: false },
  { id: "filtros", label: "Filtros aplicados", defaultOn: false },
];

export const INGRESOS_EXCEL_COLUMN_OPTIONS: ReadonlyArray<{
  id: IngresosExcelColumnId;
  label: string;
  defaultOn: boolean;
}> = [
  { id: "cliente", label: "Cliente", defaultOn: true },
  { id: "nss", label: "NSS", defaultOn: true },
  { id: "asesor", label: "Asesor", defaultOn: true },
  { id: "programa", label: "Programa", defaultOn: false },
  { id: "etapa_visible", label: "Etapa visible", defaultOn: true },
  { id: "estado_actual", label: "Estado actual", defaultOn: false },
  { id: "fecha_envio_mesa", label: "Fecha envío a Mesa", defaultOn: true },
  { id: "fecha_bio", label: "Fecha aprobación biométrica", defaultOn: false },
  { id: "fecha_pago", label: "Fecha Pago a ConCasa", defaultOn: true },
  { id: "monto_general", label: "Monto Datos Generales", defaultOn: false },
  { id: "monto_actualizado", label: "Monto actualizado por Mesa", defaultOn: false },
  { id: "monto_base", label: "Monto base utilizado", defaultOn: true },
  { id: "fuente_monto", label: "Fuente del monto", defaultOn: true },
  { id: "porcentaje", label: "Porcentaje de cobro", defaultOn: true },
  { id: "proyectado", label: "Ingreso proyectado", defaultOn: true },
  { id: "real", label: "Ingreso real", defaultOn: true },
  { id: "pendiente", label: "Pendiente por cobrar", defaultOn: true },
  { id: "estado_ingreso", label: "Estado del ingreso", defaultOn: false },
  { id: "snapshot_estimado", label: "Snapshot histórico estimado", defaultOn: false },
  { id: "expediente_id", label: "Expediente ID", defaultOn: false },
];

export function recommendedIngresosExcelConfig(): IngresosExcelExportConfig {
  return {
    sheets: INGRESOS_EXCEL_SHEET_OPTIONS.filter((s) => s.defaultOn).map((s) => s.id),
    columns: INGRESOS_EXCEL_COLUMN_OPTIONS.filter((c) => c.defaultOn).map((c) => c.id),
    reportName: "",
  };
}

export function validateIngresosExcelConfig(
  config: IngresosExcelExportConfig,
): { ok: true } | { ok: false; message: string } {
  if (config.sheets.length === 0) {
    return { ok: false, message: "Selecciona al menos una hoja." };
  }
  if (config.sheets.includes("detalle") && config.columns.length === 0) {
    return {
      ok: false,
      message: "La hoja de detalle requiere al menos una columna.",
    };
  }
  return { ok: true };
}

export function moveIngresosExcelColumn(
  columns: readonly IngresosExcelColumnId[],
  id: IngresosExcelColumnId,
  direction: "up" | "down",
): IngresosExcelColumnId[] {
  const next = [...columns];
  const idx = next.indexOf(id);
  if (idx < 0) return next;
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= next.length) return next;
  const tmp = next[idx]!;
  next[idx] = next[swap]!;
  next[swap] = tmp;
  return next;
}

export type IngresosFilterLabelRow = Readonly<{
  filtro: string;
  valor: string;
}>;

export function buildIngresosFilterLabelRows(params: {
  filters: IngresosFilters;
  asesorNombres: readonly string[];
  alcanceLabel: string;
  periodoLabel: string;
}): IngresosFilterLabelRow[] {
  const asesores =
    params.asesorNombres.length > 0
      ? params.asesorNombres.join(", ")
      : "Todos";
  const pct =
    params.filters.porcentajes.length > 0
      ? params.filters.porcentajes.map((p) => `${p}%`).join(", ")
      : "Todos";
  const fuente =
    params.filters.montoFuente === "todas"
      ? "Todas"
      : params.filters.montoFuente === "mesa_actualizado"
        ? "Actualizado por Mesa"
        : "Datos Generales";
  const estado =
    params.filters.estado === "elegibles"
      ? "Todos elegibles"
      : params.filters.estado === "pendientes"
        ? "Pendientes por cobrar"
        : "Pagados";
  return [
    { filtro: "Periodo", valor: params.periodoLabel },
    { filtro: "Asesores", valor: asesores },
    { filtro: "Alcance", valor: params.alcanceLabel },
    { filtro: "Porcentaje", valor: pct },
    { filtro: "Fuente", valor: fuente },
    { filtro: "Estado", valor: estado },
    {
      filtro: "Búsqueda",
      valor: params.filters.buscar.trim() || "—",
    },
  ];
}

export function labelIngresosStageScope(scope: IngresosStageScope): string {
  if (scope === "all_submitted") return "Todos los enviados";
  if (scope === "from_step") return "A partir de una etapa";
  return "Solo una etapa";
}
