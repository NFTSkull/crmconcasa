import ExcelJS from "exceljs";
import type {
  AdminReportDetalleRow,
  AdminReportMeta,
  AdminReportResumenRow,
} from "@/domain/admin-report-asesores-etapas";
import { groupAdminReportResumenByAsesor } from "@/domain/admin-report-asesores-etapas";

/** Paleta oficial Excel citas (P107/P113) — solo diseño visual. */
export const ADMIN_REPORT_EXCEL_COLORS = {
  purple: "FF6B2D8B",
  headerBlue: "FF1F4E79",
  altBlue: "FFD6EAF8",
  white: "FFFFFFFF",
  text: "FF1A1A1A",
  border: "FF9BB3C9",
} as const;

function sanitize(value: string): string {
  const trimmed = value.trim().slice(0, 500);
  if (/^[=+\-@]/.test(trimmed)) return `'${trimmed}`;
  return trimmed;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const edge: Partial<ExcelJS.Border> = {
    style: "thin",
    color: { argb: ADMIN_REPORT_EXCEL_COLORS.border },
  };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function solidFill(argb: string): ExcelJS.Fill {
  return {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb },
  };
}

function applyDataCell(
  cell: ExcelJS.Cell,
  value: string | number,
  opts: Readonly<{
    fillArgb: string;
    bold?: boolean;
    fontColor?: string;
    align?: Partial<ExcelJS.Alignment>;
    numFmt?: string;
  }>,
): void {
  cell.value = value;
  cell.fill = solidFill(opts.fillArgb);
  cell.border = thinBorder();
  cell.font = {
    bold: opts.bold === true,
    color: { argb: opts.fontColor ?? ADMIN_REPORT_EXCEL_COLORS.text },
    name: "Calibri",
    size: 11,
  };
  if (opts.align) cell.alignment = { ...opts.align };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
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
 * Excel P112/P113: hojas Resumen y Detalle según la consulta mostrada.
 * Datos intactos; P113 solo añade colores/bordes/anchos (paleta citas).
 * NSS como texto; sin UUID/teléfono/montos.
 */
export function buildAdminReportExpedientesWorkbook(input: Readonly<{
  resumen: readonly AdminReportResumenRow[];
  detalle: readonly AdminReportDetalleRow[];
  meta: AdminReportMeta;
}>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const groups = groupAdminReportResumenByAsesor(input.resumen);

  const resumenSheet = wb.addWorksheet("Resumen", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  resumenSheet.getColumn(1).width = 30;
  resumenSheet.getColumn(2).width = 48;
  resumenSheet.getColumn(3).width = 22;

  const headerAlign: Partial<ExcelJS.Alignment> = {
    horizontal: "center",
    vertical: "middle",
  };
  for (const [col, label] of [
    [1, "Asesor"],
    [2, "Etapa"],
    [3, "Expedientes"],
  ] as const) {
    applyDataCell(resumenSheet.getCell(1, col), label, {
      fillArgb: ADMIN_REPORT_EXCEL_COLORS.headerBlue,
      bold: true,
      fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
      align: headerAlign,
    });
  }

  let r = 2;
  let normalIdx = 0;
  for (const group of groups) {
    for (const row of group.rows) {
      const fill =
        normalIdx % 2 === 0
          ? ADMIN_REPORT_EXCEL_COLORS.altBlue
          : ADMIN_REPORT_EXCEL_COLORS.white;
      normalIdx += 1;
      applyDataCell(resumenSheet.getCell(r, 1), sanitize(row.asesor_nombre), {
        fillArgb: fill,
      });
      applyDataCell(
        resumenSheet.getCell(r, 2),
        sanitize(`Paso ${row.paso_visual} · ${row.paso_nombre}`),
        { fillArgb: fill },
      );
      applyDataCell(resumenSheet.getCell(r, 3), row.total, {
        fillArgb: fill,
        align: { horizontal: "center" },
      });
      r += 1;
    }
    const subFill = ADMIN_REPORT_EXCEL_COLORS.purple;
    applyDataCell(
      resumenSheet.getCell(r, 1),
      sanitize(`Subtotal · ${group.asesorNombre}`),
      {
        fillArgb: subFill,
        bold: true,
        fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
      },
    );
    applyDataCell(resumenSheet.getCell(r, 2), "", {
      fillArgb: subFill,
      bold: true,
      fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
    });
    applyDataCell(resumenSheet.getCell(r, 3), group.subtotal, {
      fillArgb: subFill,
      bold: true,
      fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
      align: { horizontal: "center" },
    });
    r += 1;
  }

  const totalFill = ADMIN_REPORT_EXCEL_COLORS.purple;
  applyDataCell(resumenSheet.getCell(r, 1), "TOTAL GENERAL", {
    fillArgb: totalFill,
    bold: true,
    fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
  });
  applyDataCell(resumenSheet.getCell(r, 2), "", {
    fillArgb: totalFill,
    bold: true,
    fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
  });
  applyDataCell(resumenSheet.getCell(r, 3), input.meta.expedientes, {
    fillArgb: totalFill,
    bold: true,
    fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
    align: { horizontal: "center" },
  });

  const detalleSheet = wb.addWorksheet("Detalle", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  detalleSheet.getColumn(1).width = 30;
  detalleSheet.getColumn(2).width = 45;
  detalleSheet.getColumn(3).width = 18;
  detalleSheet.getColumn(4).width = 48;

  for (const [col, label] of [
    [1, "Asesor"],
    [2, "Cliente"],
    [3, "NSS"],
    [4, "Paso actual"],
    [5, "Fecha de entrada al paso"],
  ] as const) {
    applyDataCell(detalleSheet.getCell(1, col), label, {
      fillArgb: ADMIN_REPORT_EXCEL_COLORS.headerBlue,
      bold: true,
      fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
      align: headerAlign,
    });
  }

  detalleSheet.getColumn(5).width = 26;

  input.detalle.forEach((row, idx) => {
    const fill =
      idx % 2 === 0
        ? ADMIN_REPORT_EXCEL_COLORS.altBlue
        : ADMIN_REPORT_EXCEL_COLORS.white;
    const rowNum = idx + 2;
    applyDataCell(detalleSheet.getCell(rowNum, 1), sanitize(row.asesor_nombre), {
      fillArgb: fill,
    });
    applyDataCell(
      detalleSheet.getCell(rowNum, 2),
      sanitize(row.cliente_nombre),
      { fillArgb: fill },
    );
    const nss = sanitize(String(row.nss ?? ""));
    applyDataCell(detalleSheet.getCell(rowNum, 3), nss, {
      fillArgb: fill,
      align: { horizontal: "center", vertical: "middle" },
      numFmt: "@",
    });
    applyDataCell(
      detalleSheet.getCell(rowNum, 4),
      sanitize(
        `Paso ${row.paso_visual} · ${row.paso_nombre}${
          row.estado === "rechazado" ? " · Rechazado" : ""
        }`,
      ),
      { fillArgb: fill },
    );
    applyDataCell(
      detalleSheet.getCell(rowNum, 5),
      sanitize(row.fecha_entrada_paso_actual ?? "—"),
      {
        fillArgb: fill,
        align: { horizontal: "center", vertical: "middle" },
      },
    );
  });

  return wb;
}

export async function workbookToAdminReportArrayBuffer(
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

export async function downloadAdminReportExpedientesWorkbook(
  wb: ExcelJS.Workbook,
  filename: string,
): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("La descarga solo está disponible en el navegador.");
  }
  const buffer = await workbookToAdminReportArrayBuffer(wb);
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
