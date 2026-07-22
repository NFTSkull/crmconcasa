import ExcelJS from "exceljs";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  applyMesaAgendaClientFiltersAndSort,
  defaultMesaAgendaClientFilters,
  filterMesaAgendaEntriesForDay,
  MESA_AGENDA_DEFAULT_SORT,
  type MesaAgendaCitasClientFilters,
  type MesaAgendaCitasSortOption,
} from "@/lib/mesaAgendaCitasUi";
import { sanitizeExcelFormulaInjection } from "@/lib/exportAsesorPrecalificacionesExcel";

/** Ruta pública (browser) de la plantilla oficial. */
export const MESA_CITAS_TEMPLATE_PUBLIC_PATH =
  "/templates/reporte-citas-mesa.xlsx";

/** Ruta FS relativa al cwd (tests / scripts Node). */
export const MESA_CITAS_TEMPLATE_FS_RELATIVE =
  "public/templates/reporte-citas-mesa.xlsx";

export const MESA_CITAS_EXCEL_SHEET_NAME = "Citas";

export const MESA_CITAS_EXCEL_HEADERS = [
  "Fecha",
  "NSS",
  "Nombre (Nombre completo con apellidos)",
] as const;

export type MesaCitasExcelRow = Readonly<{
  fecha: string;
  nss: string;
  nombreCompleto: string;
}>;

/** Título A1:C1 con fecha visible DD/MM/YYYY. */
export function buildMesaCitasExcelTitle(fechaYmd: string): string {
  return `CITAS DEL DÍA — ${formatMesaCitasExcelVisibleDate(fechaYmd)}`;
}

/** Convierte YYYY-MM-DD → DD/MM/YYYY (fecha visible en Excel). */
export function formatMesaCitasExcelVisibleDate(fechaYmd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaYmd.trim());
  if (!m) return fechaYmd.trim();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** @deprecated Alias de formatMesaCitasExcelVisibleDate (P107). */
export function formatMesaCitasExcelSubtitleDate(fechaYmd: string): string {
  return formatMesaCitasExcelVisibleDate(fechaYmd);
}

export function buildMesaCitasExportFilename(fechaYmd: string): string {
  const day = fechaYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("fechaYmd debe ser YYYY-MM-DD");
  }
  return `citas-mesa-${day}.xlsx`;
}

/**
 * Filas del día seleccionado + filtros activos (in-memory).
 * Independiente de selección P089 y del límite 100.
 * Orden: el sort activo (por defecto hora de cita).
 */
export function collectMesaCitasForExport(
  entries: readonly MesaAgendaBookingEntry[],
  fechaYmd: string,
  filters: MesaAgendaCitasClientFilters = defaultMesaAgendaClientFilters(),
  sortBy: MesaAgendaCitasSortOption = MESA_AGENDA_DEFAULT_SORT,
): MesaAgendaBookingEntry[] {
  const byKindAndStatus = entries.filter((entry) => {
    if (filters.kindUi !== "all" && entry.kind !== filters.kindUi) return false;
    if (!filters.includeCancelled && entry.status === "cancelled") return false;
    return true;
  });
  const filtered = applyMesaAgendaClientFiltersAndSort(
    byKindAndStatus,
    filters,
    sortBy,
  );
  return filterMesaAgendaEntriesForDay(filtered, fechaYmd.trim());
}

export function mapMesaCitaToExcelRow(
  entry: MesaAgendaBookingEntry,
): MesaCitasExcelRow {
  return {
    fecha: sanitizeExcelFormulaInjection(
      formatMesaCitasExcelVisibleDate(entry.bookingDate ?? ""),
    ),
    nss: sanitizeExcelFormulaInjection(String(entry.nss ?? "")),
    nombreCompleto: sanitizeExcelFormulaInjection(entry.clienteNombre ?? ""),
  };
}

/** Carga la plantilla desde `/templates/...` (browser o fetch disponible). */
export async function loadMesaCitasTemplateBuffer(): Promise<ArrayBuffer> {
  if (typeof fetch !== "function") {
    throw new Error("No hay fetch disponible para cargar la plantilla de citas.");
  }
  const res = await fetch(MESA_CITAS_TEMPLATE_PUBLIC_PATH);
  if (!res.ok) {
    throw new Error("No se pudo cargar la plantilla oficial de citas.");
  }
  return await res.arrayBuffer();
}

type RowStyleSnapshot = {
  height?: number;
  cells: Array<Partial<ExcelJS.Style>>;
};

function snapshotRowStyles(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
): RowStyleSnapshot {
  const row = worksheet.getRow(rowNumber);
  return {
    height: row.height,
    cells: [1, 2, 3].map((c) => {
      const cell = row.getCell(c);
      const style: Partial<ExcelJS.Style> = { ...cell.style };
      if (cell.font) style.font = { ...cell.font };
      if (cell.fill) style.fill = { ...cell.fill };
      if (cell.border) {
        style.border = {
          top: cell.border.top ? { ...cell.border.top } : undefined,
          left: cell.border.left ? { ...cell.border.left } : undefined,
          bottom: cell.border.bottom ? { ...cell.border.bottom } : undefined,
          right: cell.border.right ? { ...cell.border.right } : undefined,
        };
      }
      if (cell.alignment) style.alignment = { ...cell.alignment };
      if (cell.numFmt) style.numFmt = cell.numFmt;
      return style;
    }),
  };
}

function applySnapshotStyle(
  worksheet: ExcelJS.Worksheet,
  targetRowNumber: number,
  snapshot: RowStyleSnapshot,
): void {
  const target = worksheet.getRow(targetRowNumber);
  if (snapshot.height != null) target.height = snapshot.height;
  snapshot.cells.forEach((style, idx) => {
    const cell = target.getCell(idx + 1);
    cell.style = style;
  });
}

/**
 * Llena la plantilla oficial: título A1, encabezados fila 2, datos desde fila 3.
 * Conserva estilos; ajusta el rango activo a la última fila usada.
 */
export async function buildMesaCitasWorkbook(
  exportRows: readonly MesaCitasExcelRow[],
  fechaYmd: string,
  templateBuffer: ArrayBuffer,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(templateBuffer);

  const worksheet =
    workbook.getWorksheet(MESA_CITAS_EXCEL_SHEET_NAME) ??
    workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("La plantilla de citas no contiene una hoja válida.");
  }

  const oddStyle = snapshotRowStyles(worksheet, 3);
  const evenStyle = snapshotRowStyles(worksheet, 4);

  worksheet.getCell("A1").value = buildMesaCitasExcelTitle(fechaYmd);

  MESA_CITAS_EXCEL_HEADERS.forEach((text, idx) => {
    worksheet.getRow(2).getCell(idx + 1).value = text;
  });

  // Limpia valores previos de datos (conserva estructura hasta reescribir).
  const lastExisting = Math.max(worksheet.rowCount, 4);
  for (let r = 3; r <= lastExisting; r += 1) {
    const row = worksheet.getRow(r);
    for (let c = 1; c <= 3; c += 1) {
      row.getCell(c).value = null;
    }
  }

  exportRows.forEach((row, index) => {
    const excelRow = 3 + index;
    applySnapshotStyle(
      worksheet,
      excelRow,
      index % 2 === 0 ? oddStyle : evenStyle,
    );

    const excel = worksheet.getRow(excelRow);
    const fechaCell = excel.getCell(1);
    const nssCell = excel.getCell(2);
    const nombreCell = excel.getCell(3);

    fechaCell.value = row.fecha;
    fechaCell.numFmt = "@";

    nssCell.value = row.nss;
    nssCell.numFmt = "@";

    nombreCell.value = row.nombreCompleto;
  });

  const lastDataRow = exportRows.length === 0 ? 2 : 2 + exportRows.length;
  worksheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: Math.max(lastDataRow, 2), column: 3 },
  };

  // Recorta filas sobrantes: ExcelJS recalcula la dimensión (!ref) desde las filas usadas.
  if (exportRows.length === 0) {
    if (worksheet.rowCount > 2) {
      worksheet.spliceRows(3, worksheet.rowCount - 2);
    }
  } else if (worksheet.rowCount > lastDataRow) {
    worksheet.spliceRows(lastDataRow + 1, worksheet.rowCount - lastDataRow);
  }

  return workbook;
}

export async function workbookToMesaCitasXlsxArrayBuffer(
  wb: ExcelJS.Workbook,
): Promise<ArrayBuffer> {
  const buf = await wb.xlsx.writeBuffer();
  if (buf instanceof ArrayBuffer) return buf;
  const view = buf as ArrayBufferView;
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}

export type PrepareMesaCitasExportResult =
  | {
      ok: true;
      filename: string;
      rowCount: number;
      exportRows: MesaCitasExcelRow[];
      workbook: ExcelJS.Workbook;
    }
  | { ok: false; reason: "empty" | "invalid_date" };

export async function prepareMesaCitasExport(
  entries: readonly MesaAgendaBookingEntry[],
  fechaYmd: string,
  filters: MesaAgendaCitasClientFilters = defaultMesaAgendaClientFilters(),
  sortBy: MesaAgendaCitasSortOption = MESA_AGENDA_DEFAULT_SORT,
  templateBuffer?: ArrayBuffer,
): Promise<PrepareMesaCitasExportResult> {
  const day = fechaYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, reason: "invalid_date" };
  }

  const dayEntries = collectMesaCitasForExport(entries, day, filters, sortBy);
  if (dayEntries.length === 0) {
    return { ok: false, reason: "empty" };
  }

  const exportRows = dayEntries.map(mapMesaCitaToExcelRow);
  const buffer = templateBuffer ?? (await loadMesaCitasTemplateBuffer());
  const workbook = await buildMesaCitasWorkbook(exportRows, day, buffer);
  const filename = buildMesaCitasExportFilename(day);

  return {
    ok: true,
    filename,
    rowCount: exportRows.length,
    exportRows,
    workbook,
  };
}

/** Día operativo a exportar según la vista activa (independiente de selección P089). */
export function resolveMesaCitasExportDayYmd(params: Readonly<{
  viewMode: "lista" | "dia" | "semana";
  selectedDay: string;
  weekDetailDay: string | null;
  listaStartDate: string;
}>): string {
  if (params.viewMode === "semana") {
    return (params.weekDetailDay ?? params.selectedDay).trim();
  }
  if (params.viewMode === "lista") {
    return (params.listaStartDate || params.selectedDay).trim();
  }
  return params.selectedDay.trim();
}

export function mapMesaCitasExportUserMessage(
  result: PrepareMesaCitasExportResult | { ok: true; filename: string; rowCount: number },
): string | null {
  if (result.ok) {
    return `Se descargó ${result.filename} (${result.rowCount} cita${result.rowCount === 1 ? "" : "s"}).`;
  }
  if (result.reason === "empty") {
    return "No hay citas para exportar con la fecha y filtros actuales.";
  }
  return "La fecha seleccionada no es válida para exportar.";
}

export async function downloadMesaCitasExcel(
  entries: readonly MesaAgendaBookingEntry[],
  fechaYmd: string,
  filters: MesaAgendaCitasClientFilters = defaultMesaAgendaClientFilters(),
  sortBy: MesaAgendaCitasSortOption = MESA_AGENDA_DEFAULT_SORT,
): Promise<PrepareMesaCitasExportResult> {
  const prepared = await prepareMesaCitasExport(
    entries,
    fechaYmd,
    filters,
    sortBy,
  );
  if (!prepared.ok) return prepared;

  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("La descarga de Excel solo está disponible en el navegador.");
  }

  const buffer = await workbookToMesaCitasXlsxArrayBuffer(prepared.workbook);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = prepared.filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);

  return prepared;
}
