import * as XLSX from "xlsx";
import type {
  AdminReportDetalleRow,
  AdminReportMeta,
  AdminReportResumenRow,
} from "@/domain/admin-report-asesores-etapas";
import { groupAdminReportResumenByAsesor } from "@/domain/admin-report-asesores-etapas";

function sanitize(value: string): string {
  const trimmed = value.trim().slice(0, 500);
  if (/^[=+\-@]/.test(trimmed)) return `'${trimmed}`;
  return trimmed;
}

export function buildAdminReportExpedientesFilename(ymd: string): string {
  const day = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("ymd debe ser YYYY-MM-DD");
  }
  return `reporte-expedientes-${day}.xlsx`;
}

export function todayYmdLocal(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Excel P112: hojas Resumen y Detalle según la consulta mostrada.
 * NSS como texto; sin UUID/teléfono/montos.
 */
export function buildAdminReportExpedientesWorkbook(input: Readonly<{
  resumen: readonly AdminReportResumenRow[];
  detalle: readonly AdminReportDetalleRow[];
  meta: AdminReportMeta;
}>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const groups = groupAdminReportResumenByAsesor(input.resumen);

  const resumenAoa: (string | number)[][] = [["Asesor", "Etapa", "Expedientes"]];
  for (const group of groups) {
    for (const row of group.rows) {
      resumenAoa.push([
        sanitize(row.asesor_nombre),
        sanitize(`Paso ${row.paso_visual} · ${row.paso_nombre}`),
        row.total,
      ]);
    }
    resumenAoa.push([
      sanitize(`Subtotal · ${group.asesorNombre}`),
      "",
      group.subtotal,
    ]);
  }
  resumenAoa.push(["TOTAL GENERAL", "", input.meta.expedientes]);
  const resumenSheet = XLSX.utils.aoa_to_sheet(resumenAoa);
  XLSX.utils.book_append_sheet(wb, resumenSheet, "Resumen");

  const detalleAoa: (string | number)[][] = [
    ["Asesor", "Cliente", "NSS", "Paso actual"],
  ];
  for (const row of input.detalle) {
    detalleAoa.push([
      sanitize(row.asesor_nombre),
      sanitize(row.cliente_nombre),
      sanitize(String(row.nss ?? "")),
      sanitize(
        `Paso ${row.paso_visual} · ${row.paso_nombre}${
          row.estado === "rechazado" ? " · Rechazado" : ""
        }`,
      ),
    ]);
  }
  const detalleSheet = XLSX.utils.aoa_to_sheet(detalleAoa);
  // Forzar NSS como texto en columna C (índice 2)
  const range = XLSX.utils.decode_range(detalleSheet["!ref"] ?? "A1");
  for (let r = 1; r <= range.e.r; r += 1) {
    const addr = XLSX.utils.encode_cell({ r, c: 2 });
    const cell = detalleSheet[addr];
    if (cell) {
      cell.t = "s";
      cell.z = "@";
      cell.v = String(cell.v ?? "");
    }
  }
  XLSX.utils.book_append_sheet(wb, detalleSheet, "Detalle");

  return wb;
}

export function downloadAdminReportExpedientesWorkbook(
  wb: XLSX.WorkBook,
  filename: string,
): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("La descarga solo está disponible en el navegador.");
  }
  XLSX.writeFile(wb, filename);
}
