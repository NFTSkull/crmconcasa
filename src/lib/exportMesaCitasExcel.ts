import ExcelJS from "exceljs";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  MESA_AGENDA_REPORT_GROUP_LABELS,
  MESA_AGENDA_REPORT_GROUP_ORDER,
  resolveMesaAgendaReportGroup,
  type MesaAgendaReportGroup,
} from "@/domain/agenda-calendar/mesa-report-group";
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

/** Máximo de bloques lado a lado (P109). */
export const MESA_CITAS_EXCEL_BLOCKS_PER_ROW = 3;

/**
 * Hora oficial de presentación/agrupación Excel para Firmas (P110).
 * No muta `booking_time` real ni la UI de Citas Mesa.
 */
export const MESA_CITAS_EXCEL_FIRMAS_OFFICIAL_TIME = "09:30";

/** Columnas de datos por bloque + 1 columna vacía de separación. */
const COLS_PER_BLOCK = 3;
const COL_STRIDE = COLS_PER_BLOCK + 1;

export type MesaCitasExcelRow = Readonly<{
  fecha: string;
  nss: string;
  nombreCompleto: string;
}>;

export type MesaCitasExcelBlock = Readonly<{
  reportGroup: MesaAgendaReportGroup;
  bookingTime: string | null;
  title: string;
  rows: readonly MesaCitasExcelRow[];
  bookingIds: readonly string[];
}>;

/** Título legado P107 (día completo). P109 usa títulos por bloque. */
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

/** Normaliza TIME/`HH:mm`/`HH:mm:ss` a `HH:mm`; null si vacío/inválido. */
export function normalizeMesaCitasExcelBookingTime(
  value: string | null | undefined,
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(raw);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Etiqueta 12h (`8:00 AM`) o null si no hay hora. */
export function formatMesaCitasExcelTimeLabel12h(
  bookingTime: string | null | undefined,
): string | null {
  const normalized = normalizeMesaCitasExcelBookingTime(bookingTime);
  if (!normalized) return null;
  const [hRaw, mRaw] = normalized.split(":").map(Number);
  const h = hRaw ?? 0;
  const m = mRaw ?? 0;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function buildMesaCitasExcelBlockTitle(
  reportGroup: MesaAgendaReportGroup,
  bookingTime: string | null | undefined,
): string {
  const label = MESA_AGENDA_REPORT_GROUP_LABELS[reportGroup];
  if (reportGroup === "firmas") {
    return `${label} — ${formatMesaCitasExcelTimeLabel12h(MESA_CITAS_EXCEL_FIRMAS_OFFICIAL_TIME)}`;
  }
  const timeLabel = formatMesaCitasExcelTimeLabel12h(bookingTime);
  if (!timeLabel) return `${label} — SIN HORARIO`;
  return `${label} — ${timeLabel}`;
}

/**
 * Hora de bloque Excel: Firmas fuerza 09:30 oficial; resto usa bookingTime real.
 * No altera el booking operativo.
 */
export function resolveMesaCitasExcelBlockTime(
  reportGroup: MesaAgendaReportGroup,
  bookingTime: string | null | undefined,
): string | null {
  if (reportGroup === "firmas") {
    return MESA_CITAS_EXCEL_FIRMAS_OFFICIAL_TIME;
  }
  return normalizeMesaCitasExcelBookingTime(bookingTime);
}

/**
 * Agrupa citas por `report_group` resuelto + hora de bloque Excel.
 * Firmas del día → un solo bloque `FIRMAS — 9:30 AM`.
 * Orden: grupos canónicos → hora ascendente (SIN HORARIO al final).
 */
export function groupMesaCitasIntoExcelBlocks(
  entries: readonly MesaAgendaBookingEntry[],
): MesaCitasExcelBlock[] {
  const buckets = new Map<
    string,
    {
      reportGroup: MesaAgendaReportGroup;
      bookingTime: string | null;
      entries: MesaAgendaBookingEntry[];
    }
  >();

  for (const entry of entries) {
    const reportGroup = resolveMesaAgendaReportGroup(entry);
    const bookingTime = resolveMesaCitasExcelBlockTime(
      reportGroup,
      entry.bookingTime,
    );
    const key = `${reportGroup}|${bookingTime ?? ""}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      buckets.set(key, { reportGroup, bookingTime, entries: [entry] });
    }
  }

  const groupRank = new Map(
    MESA_AGENDA_REPORT_GROUP_ORDER.map((g, idx) => [g, idx]),
  );

  const sorted = [...buckets.values()].sort((a, b) => {
    const ra = groupRank.get(a.reportGroup) ?? 99;
    const rb = groupRank.get(b.reportGroup) ?? 99;
    if (ra !== rb) return ra - rb;
    if (a.bookingTime == null && b.bookingTime == null) return 0;
    if (a.bookingTime == null) return 1;
    if (b.bookingTime == null) return -1;
    return a.bookingTime.localeCompare(b.bookingTime);
  });

  return sorted.map((bucket) => ({
    reportGroup: bucket.reportGroup,
    bookingTime: bucket.bookingTime,
    title: buildMesaCitasExcelBlockTitle(
      bucket.reportGroup,
      bucket.bookingTime,
    ),
    rows: bucket.entries.map(mapMesaCitaToExcelRow),
    bookingIds: bucket.entries.map((e) => e.bookingId),
  }));
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

type CellStyleSnapshot = Partial<ExcelJS.Style>;

type BlockStyleKit = {
  title: CellStyleSnapshot;
  titleHeight?: number;
  header: CellStyleSnapshot[];
  headerHeight?: number;
  odd: CellStyleSnapshot[];
  even: CellStyleSnapshot[];
  oddHeight?: number;
  evenHeight?: number;
  colWidths: number[];
};

function cloneStyle(style: Partial<ExcelJS.Style> | undefined): CellStyleSnapshot {
  if (!style) return {};
  const out: CellStyleSnapshot = { ...style };
  if (style.font) out.font = { ...style.font };
  if (style.fill) out.fill = { ...style.fill };
  if (style.border) {
    out.border = {
      top: style.border.top ? { ...style.border.top } : undefined,
      left: style.border.left ? { ...style.border.left } : undefined,
      bottom: style.border.bottom ? { ...style.border.bottom } : undefined,
      right: style.border.right ? { ...style.border.right } : undefined,
    };
  }
  if (style.alignment) out.alignment = { ...style.alignment };
  if (style.numFmt) out.numFmt = style.numFmt;
  return out;
}

function snapshotBlockStyles(worksheet: ExcelJS.Worksheet): BlockStyleKit {
  const titleCell = worksheet.getCell(1, 1);
  const headerRow = worksheet.getRow(2);
  const oddRow = worksheet.getRow(3);
  const evenRow = worksheet.getRow(4);
  return {
    title: cloneStyle(titleCell.style),
    titleHeight: worksheet.getRow(1).height,
    header: [1, 2, 3].map((c) => cloneStyle(headerRow.getCell(c).style)),
    headerHeight: headerRow.height,
    odd: [1, 2, 3].map((c) => cloneStyle(oddRow.getCell(c).style)),
    even: [1, 2, 3].map((c) => cloneStyle(evenRow.getCell(c).style)),
    oddHeight: oddRow.height,
    evenHeight: evenRow.height,
    colWidths: [1, 2, 3].map((c) => worksheet.getColumn(c).width ?? 14),
  };
}

function applyCellStyle(
  cell: ExcelJS.Cell,
  style: CellStyleSnapshot,
): void {
  cell.style = cloneStyle(style);
}

function clearWorksheetUsedArea(worksheet: ExcelJS.Worksheet): void {
  const lastRow = Math.max(worksheet.rowCount, 4);
  const lastCol = Math.max(worksheet.columnCount, COL_STRIDE * MESA_CITAS_EXCEL_BLOCKS_PER_ROW);
  for (let r = 1; r <= lastRow; r += 1) {
    const row = worksheet.getRow(r);
    for (let c = 1; c <= lastCol; c += 1) {
      const cell = row.getCell(c);
      cell.value = null;
      cell.style = {};
    }
  }
  // Quita fusiones previas de la plantilla (A1:C1).
  const merges = [...(worksheet.model.merges ?? [])];
  for (const merge of merges) {
    try {
      worksheet.unMergeCells(merge);
    } catch {
      // ignore
    }
  }
  worksheet.autoFilter = undefined;
}

function blockStartColumn(indexInRow: number): number {
  return 1 + indexInRow * COL_STRIDE;
}

function writeExcelBlock(
  worksheet: ExcelJS.Worksheet,
  block: MesaCitasExcelBlock,
  startRow: number,
  startCol: number,
  styles: BlockStyleKit,
): number {
  const titleRow = worksheet.getRow(startRow);
  if (styles.titleHeight != null) titleRow.height = styles.titleHeight;

  const endCol = startCol + COLS_PER_BLOCK - 1;
  worksheet.mergeCells(startRow, startCol, startRow, endCol);
  const titleCell = worksheet.getCell(startRow, startCol);
  titleCell.value = block.title;
  applyCellStyle(titleCell, styles.title);
  for (let c = startCol + 1; c <= endCol; c += 1) {
    applyCellStyle(worksheet.getCell(startRow, c), styles.title);
  }

  const headerRowNumber = startRow + 1;
  const headerRow = worksheet.getRow(headerRowNumber);
  if (styles.headerHeight != null) headerRow.height = styles.headerHeight;
  MESA_CITAS_EXCEL_HEADERS.forEach((text, idx) => {
    const cell = headerRow.getCell(startCol + idx);
    cell.value = text;
    applyCellStyle(cell, styles.header[idx] ?? {});
  });

  block.rows.forEach((row, index) => {
    const excelRowNumber = startRow + 2 + index;
    const excelRow = worksheet.getRow(excelRowNumber);
    const rowStyles = index % 2 === 0 ? styles.odd : styles.even;
    const height = index % 2 === 0 ? styles.oddHeight : styles.evenHeight;
    if (height != null) excelRow.height = height;

    const fechaCell = excelRow.getCell(startCol);
    const nssCell = excelRow.getCell(startCol + 1);
    const nombreCell = excelRow.getCell(startCol + 2);

    applyCellStyle(fechaCell, rowStyles[0] ?? {});
    applyCellStyle(nssCell, rowStyles[1] ?? {});
    applyCellStyle(nombreCell, rowStyles[2] ?? {});

    fechaCell.value = row.fecha;
    fechaCell.numFmt = "@";
    nssCell.value = row.nss;
    nssCell.numFmt = "@";
    nombreCell.value = row.nombreCompleto;
  });

  return 2 + block.rows.length;
}

/**
 * Llena la plantilla oficial en bloques por report_group + hora (P109).
 * Máx. 3 bloques horizontales; columna vacía entre bloques; siguiente fila
 * según la altura mayor del renglón de bloques.
 */
export async function buildMesaCitasWorkbook(
  blocks: readonly MesaCitasExcelBlock[],
  _fechaYmd: string,
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

  const styles = snapshotBlockStyles(worksheet);
  clearWorksheetUsedArea(worksheet);

  // Anchos de columna para hasta 3 bloques.
  for (let i = 0; i < MESA_CITAS_EXCEL_BLOCKS_PER_ROW; i += 1) {
    const start = blockStartColumn(i);
    for (let j = 0; j < COLS_PER_BLOCK; j += 1) {
      worksheet.getColumn(start + j).width = styles.colWidths[j] ?? 14;
    }
    if (i < MESA_CITAS_EXCEL_BLOCKS_PER_ROW - 1) {
      worksheet.getColumn(start + COLS_PER_BLOCK).width = 2;
    }
  }

  let cursorRow = 1;
  let index = 0;
  while (index < blocks.length) {
    const rowBlocks = blocks.slice(index, index + MESA_CITAS_EXCEL_BLOCKS_PER_ROW);
    let maxHeight = 0;
    rowBlocks.forEach((block, idxInRow) => {
      const height = writeExcelBlock(
        worksheet,
        block,
        cursorRow,
        blockStartColumn(idxInRow),
        styles,
      );
      maxHeight = Math.max(maxHeight, height);
    });
    cursorRow += maxHeight;
    index += MESA_CITAS_EXCEL_BLOCKS_PER_ROW;
  }

  const lastUsedRow = Math.max(cursorRow - 1, 1);
  if (worksheet.rowCount > lastUsedRow) {
    worksheet.spliceRows(lastUsedRow + 1, worksheet.rowCount - lastUsedRow);
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
      blocks: MesaCitasExcelBlock[];
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

  const blocks = groupMesaCitasIntoExcelBlocks(dayEntries);
  const exportRows = blocks.flatMap((b) => [...b.rows]);
  const buffer = templateBuffer ?? (await loadMesaCitasTemplateBuffer());
  const workbook = await buildMesaCitasWorkbook(blocks, day, buffer);
  const filename = buildMesaCitasExportFilename(day);

  return {
    ok: true,
    filename,
    rowCount: exportRows.length,
    exportRows,
    blocks,
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
