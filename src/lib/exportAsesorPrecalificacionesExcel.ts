import * as XLSX from "xlsx";
import { mapProgramaDbToUi, mapProgramaUiToDb } from "@/domain/expedientes/map-programa";

/** Filtro de exportación (solo Mejoravit + Compra de casa / compro_tu_casa). */
export type AsesorExportProgramaFilter = "mejoravit" | "compro_tu_casa" | "ambos";

export const ASESOR_EXPORT_PROGRAMA_OPTIONS: ReadonlyArray<{
  value: AsesorExportProgramaFilter;
  label: string;
}> = [
  { value: "mejoravit", label: "Mejoravit" },
  { value: "compro_tu_casa", label: "Compra de casa" },
  { value: "ambos", label: "Ambos" },
];

const EXPORT_PROGRAMA_DB_KEYS: Readonly<Record<AsesorExportProgramaFilter, readonly string[]>> = {
  mejoravit: ["mejoravit"],
  compro_tu_casa: ["compro_tu_casa"],
  ambos: ["mejoravit", "compro_tu_casa"],
};

export const ASESOR_EXPORT_EXCEL_HEADERS = [
  "Nombre completo",
  "NSS",
  "Teléfono",
  "Programa",
  "Monto aprobado",
] as const;

export type AsesorPrecalificacionExportSource = Readonly<{
  id: string;
  asesorId: string;
  cliente_nombre: string;
  nss: string;
  telefono_cliente: string;
  programa: string;
  monto_aprobado: number | null;
}>;

export type AsesorPrecalificacionExportRow = Readonly<{
  nombreCompleto: string;
  nss: string;
  telefono: string;
  programa: string;
  montoAprobado: number | null;
}>;

export function normalizeProgramaDbKey(programa: string): string {
  const db = mapProgramaUiToDb(programa.trim());
  return db.trim().toLowerCase();
}

export function programaMatchesExportFilter(
  programa: string,
  filter: AsesorExportProgramaFilter,
): boolean {
  const dbKey = normalizeProgramaDbKey(programa);
  return EXPORT_PROGRAMA_DB_KEYS[filter].includes(dbKey);
}

/** Solo registros del asesor autenticado + filtro de programa (sin paginación ni búsqueda). */
export function filterPrecalificacionesForAsesorExport(
  rows: readonly AsesorPrecalificacionExportSource[],
  filter: AsesorExportProgramaFilter,
  currentAsesorId: string,
): AsesorPrecalificacionExportSource[] {
  const owner = currentAsesorId.trim().toLowerCase();
  if (!owner) return [];

  return rows.filter((row) => {
    if (row.asesorId.trim().toLowerCase() !== owner) return false;
    return programaMatchesExportFilter(row.programa, filter);
  });
}

export function sanitizeExcelFormulaInjection(value: string): string {
  const trimmed = value.trim();
  if (/^[=+\-@]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

export function mapPrecalificacionToExportRow(
  row: AsesorPrecalificacionExportSource,
): AsesorPrecalificacionExportRow {
  return {
    nombreCompleto: sanitizeExcelFormulaInjection(row.cliente_nombre ?? ""),
    nss: sanitizeExcelFormulaInjection(String(row.nss ?? "")),
    telefono: sanitizeExcelFormulaInjection(String(row.telefono_cliente ?? "")),
    programa: mapProgramaDbToUi(row.programa ?? ""),
    montoAprobado:
      typeof row.monto_aprobado === "number" && !Number.isNaN(row.monto_aprobado)
        ? row.monto_aprobado
        : null,
  };
}

export function buildAsesorExportFilename(
  filter: AsesorExportProgramaFilter,
  date: Date = new Date(),
): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const suffix =
    filter === "mejoravit"
      ? "mejoravit"
      : filter === "compro_tu_casa"
        ? "compra_casa"
        : "ambos";
  return `precalificaciones_${suffix}_${y}-${m}-${d}.xlsx`;
}

function exportRowToSheetValues(row: AsesorPrecalificacionExportRow): (string | number | null)[] {
  return [
    row.nombreCompleto,
    row.nss,
    row.telefono,
    row.programa,
    row.montoAprobado,
  ];
}

export function buildAsesorPrecalificacionesWorkbook(
  exportRows: readonly AsesorPrecalificacionExportRow[],
): XLSX.WorkBook {
  const aoa: (string | number | null)[][] = [
    [...ASESOR_EXPORT_EXCEL_HEADERS],
    ...exportRows.map(exportRowToSheetValues),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  for (let r = 1; r < aoa.length; r += 1) {
    const nssCell = XLSX.utils.encode_cell({ r, c: 1 });
    const telCell = XLSX.utils.encode_cell({ r, c: 2 });
    const montoCell = XLSX.utils.encode_cell({ r, c: 4 });

    if (ws[nssCell]) {
      ws[nssCell].t = "s";
      ws[nssCell].z = "@";
    }
    if (ws[telCell]) {
      ws[telCell].t = "s";
      ws[telCell].z = "@";
    }
    if (ws[montoCell] && typeof ws[montoCell].v === "number") {
      ws[montoCell].t = "n";
      ws[montoCell].z = "$#,##0.00";
    }
  }

  ws["!cols"] = [
    { wch: 32 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Precalificaciones");
  return wb;
}

export function workbookToXlsxArrayBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return out as ArrayBuffer;
}

export type DownloadAsesorPrecalificacionesExcelResult =
  | { ok: true; filename: string; rowCount: number }
  | { ok: false; reason: "empty" | "no_owner" };

export function prepareAsesorPrecalificacionesExport(
  rows: readonly AsesorPrecalificacionExportSource[],
  filter: AsesorExportProgramaFilter,
  currentAsesorId: string,
): DownloadAsesorPrecalificacionesExcelResult & {
  exportRows?: AsesorPrecalificacionExportRow[];
  workbook?: XLSX.WorkBook;
  filename?: string;
} {
  if (!currentAsesorId.trim()) {
    return { ok: false, reason: "no_owner" };
  }

  const filtered = filterPrecalificacionesForAsesorExport(rows, filter, currentAsesorId);
  if (filtered.length === 0) {
    return { ok: false, reason: "empty" };
  }

  const exportRows = filtered.map(mapPrecalificacionToExportRow);
  const workbook = buildAsesorPrecalificacionesWorkbook(exportRows);
  const filename = buildAsesorExportFilename(filter);

  return {
    ok: true,
    filename,
    rowCount: exportRows.length,
    exportRows,
    workbook,
  };
}

export function downloadAsesorPrecalificacionesExcel(
  rows: readonly AsesorPrecalificacionExportSource[],
  filter: AsesorExportProgramaFilter,
  currentAsesorId: string,
): DownloadAsesorPrecalificacionesExcelResult {
  const prepared = prepareAsesorPrecalificacionesExport(rows, filter, currentAsesorId);
  if (!prepared.ok || !prepared.workbook || !prepared.filename) {
    return prepared.ok === false
      ? prepared
      : { ok: false, reason: "empty" };
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("La descarga de Excel solo está disponible en el navegador.");
  }

  const buffer = workbookToXlsxArrayBuffer(prepared.workbook);
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

  return { ok: true, filename: prepared.filename, rowCount: prepared.rowCount };
}
