import * as XLSX from "xlsx";
import type { MesaAgendaBookingEntry } from "@/domain/agenda-calendar/mesa.types";
import {
  applyMesaAgendaClientFiltersAndSort,
  defaultMesaAgendaClientFilters,
  filterMesaAgendaEntriesForDay,
  MESA_AGENDA_DEFAULT_SORT,
  parseMesaAgendaYmd,
  type MesaAgendaCitasClientFilters,
  type MesaAgendaCitasSortOption,
} from "@/lib/mesaAgendaCitasUi";
import { sanitizeExcelFormulaInjection } from "@/lib/exportAsesorPrecalificacionesExcel";

export const MESA_CITAS_EXCEL_TITLE = "CITAS MESA DE CONTROL";
export const MESA_CITAS_EXCEL_SHEET_NAME = "Citas";

export const MESA_CITAS_EXCEL_HEADERS = ["Fecha", "NSS", "Nombre completo"] as const;

export type MesaCitasExcelRow = Readonly<{
  fecha: string;
  nss: string;
  nombreCompleto: string;
}>;

/** Formato mexicano del YMD seleccionado (subtítulo del workbook). */
export function formatMesaCitasExcelSubtitleDate(fechaYmd: string): string {
  const dt = parseMesaAgendaYmd(fechaYmd.trim());
  return dt.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
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
 * Aplica kind/canceladas en cliente (además de sede/asesor/búsqueda) para
 * coincidir con filtros UI aunque el bucket en memoria esté mezclado.
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
  const filtered = applyMesaAgendaClientFiltersAndSort(byKindAndStatus, filters, sortBy);
  return filterMesaAgendaEntriesForDay(filtered, fechaYmd.trim());
}

export function mapMesaCitaToExcelRow(entry: MesaAgendaBookingEntry): MesaCitasExcelRow {
  return {
    fecha: sanitizeExcelFormulaInjection(entry.bookingDate ?? ""),
    nss: sanitizeExcelFormulaInjection(String(entry.nss ?? "")),
    nombreCompleto: sanitizeExcelFormulaInjection(entry.clienteNombre ?? ""),
  };
}

export function buildMesaCitasWorkbook(
  exportRows: readonly MesaCitasExcelRow[],
  fechaYmd: string,
): XLSX.WorkBook {
  const subtitle = formatMesaCitasExcelSubtitleDate(fechaYmd);
  const aoa: (string | number | null)[][] = [
    [MESA_CITAS_EXCEL_TITLE, null, null],
    [subtitle, null, null],
    [...MESA_CITAS_EXCEL_HEADERS],
    ...exportRows.map((row) => [row.fecha, row.nss, row.nombreCompleto]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
  ];
  ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 40 }];
  ws["!autofilter"] = {
    ref: XLSX.utils.encode_range({
      s: { r: 2, c: 0 },
      e: { r: Math.max(2, aoa.length - 1), c: 2 },
    }),
  };

  // Encabezados + datos: Fecha/NSS centrados vía tipo texto; NSS siempre string.
  const headerRow = 2;
  for (let r = headerRow; r < aoa.length; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      cell.t = "s";
      if (c === 0 || c === 1) {
        cell.z = "@";
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, MESA_CITAS_EXCEL_SHEET_NAME);
  return wb;
}

export function workbookToMesaCitasXlsxArrayBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return out as ArrayBuffer;
}

export type PrepareMesaCitasExportResult =
  | {
      ok: true;
      filename: string;
      rowCount: number;
      exportRows: MesaCitasExcelRow[];
      workbook: XLSX.WorkBook;
    }
  | { ok: false; reason: "empty" | "invalid_date" };

export function prepareMesaCitasExport(
  entries: readonly MesaAgendaBookingEntry[],
  fechaYmd: string,
  filters: MesaAgendaCitasClientFilters = defaultMesaAgendaClientFilters(),
  sortBy: MesaAgendaCitasSortOption = MESA_AGENDA_DEFAULT_SORT,
): PrepareMesaCitasExportResult {
  const day = fechaYmd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ok: false, reason: "invalid_date" };
  }

  const dayEntries = collectMesaCitasForExport(entries, day, filters, sortBy);
  if (dayEntries.length === 0) {
    return { ok: false, reason: "empty" };
  }

  const exportRows = dayEntries.map(mapMesaCitaToExcelRow);
  const workbook = buildMesaCitasWorkbook(exportRows, day);
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

export function downloadMesaCitasExcel(
  entries: readonly MesaAgendaBookingEntry[],
  fechaYmd: string,
  filters: MesaAgendaCitasClientFilters = defaultMesaAgendaClientFilters(),
  sortBy: MesaAgendaCitasSortOption = MESA_AGENDA_DEFAULT_SORT,
): PrepareMesaCitasExportResult {
  const prepared = prepareMesaCitasExport(entries, fechaYmd, filters, sortBy);
  if (!prepared.ok) return prepared;

  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("La descarga de Excel solo está disponible en el navegador.");
  }

  const buffer = workbookToMesaCitasXlsxArrayBuffer(prepared.workbook);
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
