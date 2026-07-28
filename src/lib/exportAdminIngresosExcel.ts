import ExcelJS from "exceljs";
import { ADMIN_REPORT_EXCEL_COLORS } from "@/lib/exportAdminReportExpedientesExcel";
import type {
  IngresosDetalleItem,
  IngresosFilters,
  IngresosResumen,
} from "@/domain/admin-ingresos/types";
import type {
  IngresosExcelColumnId,
  IngresosExcelExportConfig,
  IngresosExcelSheetId,
  IngresosFilterLabelRow,
} from "@/domain/admin-ingresos/export-config";
import { INGRESOS_EXCEL_COLUMN_OPTIONS } from "@/domain/admin-ingresos/export-config";

const COLORS = {
  ...ADMIN_REPORT_EXCEL_COLORS,
  headerDark: "FF0F2942",
  accent: "FF0F766E",
  total: "FF134E4A",
  alt: "FFE8F5F1",
} as const;

function sanitize(value: string): string {
  const trimmed = value.trim().slice(0, 500);
  if (/^[=+\-@]/.test(trimmed)) return `'${trimmed}`;
  return trimmed;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const edge: Partial<ExcelJS.Border> = {
    style: "thin",
    color: { argb: COLORS.border },
  };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function applyCell(
  cell: ExcelJS.Cell,
  value: ExcelJS.CellValue,
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
    color: { argb: opts.fontColor ?? COLORS.text },
    name: "Calibri",
    size: 11,
  };
  if (opts.align) cell.alignment = { wrapText: true, ...opts.align };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fuenteLabel(f: string | null | undefined): string {
  if (f === "mesa_actualizado") return "Actualizado por Mesa";
  if (f === "datos_generales") return "Datos Generales";
  return "—";
}

function estadoIngreso(it: IngresosDetalleItem): string {
  return it.ingreso_real != null ? "Pagado" : "Pendiente";
}

function columnLabel(id: IngresosExcelColumnId): string {
  return INGRESOS_EXCEL_COLUMN_OPTIONS.find((c) => c.id === id)?.label ?? id;
}

function cellForColumn(
  id: IngresosExcelColumnId,
  it: IngresosDetalleItem,
): { value: ExcelJS.CellValue; numFmt?: string } {
  switch (id) {
    case "cliente":
      return { value: sanitize(it.cliente_nombre ?? "—") };
    case "nss":
      return { value: sanitize(it.nss ?? "") };
    case "asesor":
      return { value: sanitize(it.asesor_nombre ?? "—") };
    case "programa":
      return { value: sanitize(it.programa ?? "—") };
    case "etapa_visible":
      return {
        value:
          it.paso_visual != null ? `Paso ${it.paso_visual}` : `Etapa ${it.etapa_actual}`,
      };
    case "estado_actual":
      return {
        value: sanitize(
          [it.ciclo_estado, it.subestado].filter(Boolean).join(" · ") || "—",
        ),
      };
    case "fecha_envio_mesa": {
      const d = parseIsoDate(it.fecha_envio_mesa);
      return d
        ? { value: d, numFmt: "dd/mm/yyyy hh:mm" }
        : { value: "—" };
    }
    case "fecha_bio": {
      const d = parseIsoDate(it.bio_aprobacion_at);
      return d
        ? { value: d, numFmt: "dd/mm/yyyy hh:mm" }
        : { value: "—" };
    }
    case "fecha_pago": {
      const d = parseIsoDate(it.pago_concasa_at);
      return d
        ? { value: d, numFmt: "dd/mm/yyyy hh:mm" }
        : { value: "—" };
    }
    case "monto_general":
      return it.monto_general != null
        ? { value: it.monto_general, numFmt: "$#,##0.00" }
        : { value: "—" };
    case "monto_actualizado":
      return it.monto_actualizado != null
        ? { value: it.monto_actualizado, numFmt: "$#,##0.00" }
        : { value: "—" };
    case "monto_base":
      return it.monto_base != null
        ? { value: it.monto_base, numFmt: "$#,##0.00" }
        : { value: "—" };
    case "fuente_monto":
      return { value: fuenteLabel(it.monto_fuente) };
    case "porcentaje":
      return it.porcentaje_cobro != null
        ? { value: Number(it.porcentaje_cobro) / 100, numFmt: "0.00%" }
        : { value: "—" };
    case "proyectado":
      return it.ingreso_proyectado != null
        ? { value: it.ingreso_proyectado, numFmt: "$#,##0.00" }
        : { value: "—" };
    case "real":
      return it.ingreso_real != null
        ? { value: it.ingreso_real, numFmt: "$#,##0.00" }
        : { value: "—" };
    case "pendiente":
      return it.pendiente != null
        ? { value: it.pendiente, numFmt: "$#,##0.00" }
        : { value: "—" };
    case "estado_ingreso":
      return { value: estadoIngreso(it) };
    case "snapshot_estimado":
      return { value: it.is_historical_estimate ? "Sí" : "No" };
    case "expediente_id":
      return { value: sanitize(it.expediente_id) };
    default:
      return { value: "—" };
  }
}

export function buildIngresosExcelFilename(params: {
  now?: Date;
  reportName?: string;
  asesorSlug?: string | null;
}): string {
  const now = params.now ?? new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const base = `Ingresos_ConCasa_${y}-${m}-${d}_${hh}${mm}`;
  const parts = [base];
  const slug = (params.asesorSlug ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  if (slug) parts.push(slug);
  const custom = (params.reportName ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  if (custom) parts.push(custom);
  return `${parts.join("_")}.xlsx`;
}

function writeTitleBlock(
  sheet: ExcelJS.Worksheet,
  meta: Readonly<{
    generatedAtLabel: string;
    actorNombre: string;
    orgNombre: string;
    periodoLabel: string;
    timezone: string;
  }>,
): number {
  applyCell(sheet.getCell(1, 1), "ConCasa — Reporte de Ingresos", {
    fillArgb: COLORS.headerDark,
    bold: true,
    fontColor: COLORS.white,
    align: { vertical: "middle" },
  });
  sheet.mergeCells(1, 1, 1, 4);
  sheet.getRow(1).height = 24;

  const lines = [
    `Generado: ${meta.generatedAtLabel}`,
    `Usuario: ${meta.actorNombre}`,
    `Organización: ${meta.orgNombre}`,
    `Periodo: ${meta.periodoLabel}`,
    `Timezone: ${meta.timezone}`,
  ];
  let r = 2;
  for (const line of lines) {
    applyCell(sheet.getCell(r, 1), sanitize(line), {
      fillArgb: COLORS.alt,
      align: { vertical: "middle" },
    });
    sheet.mergeCells(r, 1, r, 4);
    r += 1;
  }
  return r + 1;
}

function addMoneyRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  label: string,
  value: number,
  opts?: { pct?: boolean; int?: boolean },
): void {
  applyCell(sheet.getCell(row, 1), label, {
    fillArgb: COLORS.white,
    bold: true,
  });
  if (opts?.pct) {
    applyCell(sheet.getCell(row, 2), value / 100, {
      fillArgb: COLORS.white,
      numFmt: "0.00%",
    });
  } else if (opts?.int) {
    applyCell(sheet.getCell(row, 2), value, {
      fillArgb: COLORS.white,
      numFmt: "#,##0",
    });
  } else {
    applyCell(sheet.getCell(row, 2), value, {
      fillArgb: COLORS.white,
      numFmt: "$#,##0.00",
    });
  }
}

function buildResumenSheet(
  wb: ExcelJS.Workbook,
  resumen: IngresosResumen,
  meta: Parameters<typeof writeTitleBlock>[1],
  filterRows: readonly IngresosFilterLabelRow[],
): void {
  const sheet = wb.addWorksheet("Resumen ejecutivo", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  sheet.getColumn(1).width = 42;
  sheet.getColumn(2).width = 22;
  let r = writeTitleBlock(sheet, meta);

  applyCell(sheet.getCell(r, 1), "Indicador", {
    fillArgb: COLORS.headerBlue,
    bold: true,
    fontColor: COLORS.white,
  });
  applyCell(sheet.getCell(r, 2), "Valor", {
    fillArgb: COLORS.headerBlue,
    bold: true,
    fontColor: COLORS.white,
  });
  r += 1;

  const kpis: Array<[string, number, { pct?: boolean; int?: boolean }?]> = [
    ["Ingreso proyectado", resumen.ingreso_proyectado],
    ["Ingreso real", resumen.ingreso_real],
    ["Pendiente por cobrar", resumen.pendiente_por_cobrar],
    ["Cumplimiento", resumen.cumplimiento_pct, { pct: true }],
    ["Expedientes proyectados", resumen.expedientes_proyectados, { int: true }],
    ["Expedientes pagados", resumen.expedientes_pagados, { int: true }],
    ["Casos incompletos", resumen.sin_datos_cobro.total, { int: true }],
    ["Ticket promedio proyectado", resumen.ticket_promedio_proyectado],
    ["Ticket promedio real", resumen.ticket_promedio_real],
  ];
  for (const [label, value, opt] of kpis) {
    addMoneyRow(sheet, r, label, value, opt);
    r += 1;
  }

  r += 1;
  applyCell(sheet.getCell(r, 1), "Criterios del reporte", {
    fillArgb: COLORS.accent,
    bold: true,
    fontColor: COLORS.white,
  });
  sheet.mergeCells(r, 1, r, 2);
  r += 1;
  const criterios = [
    "Fórmula: Monto base × porcentaje de cobro",
    "Prioridad: Monto actualizado por Mesa → Datos Generales",
    "Rechazados activos y cancelados excluidos",
    "Ingreso real reconocido en Pago a ConCasa",
    "Sin tope administrativo de $169,000",
  ];
  for (const c of criterios) {
    applyCell(sheet.getCell(r, 1), sanitize(c), { fillArgb: COLORS.alt });
    sheet.mergeCells(r, 1, r, 2);
    r += 1;
  }

  r += 1;
  applyCell(sheet.getCell(r, 1), "Filtros aplicados", {
    fillArgb: COLORS.headerBlue,
    bold: true,
    fontColor: COLORS.white,
  });
  applyCell(sheet.getCell(r, 2), "Valor", {
    fillArgb: COLORS.headerBlue,
    bold: true,
    fontColor: COLORS.white,
  });
  r += 1;
  for (const fr of filterRows) {
    applyCell(sheet.getCell(r, 1), sanitize(fr.filtro), { fillArgb: COLORS.white });
    applyCell(sheet.getCell(r, 2), sanitize(fr.valor), { fillArgb: COLORS.white });
    r += 1;
  }
}

function buildDetalleSheet(
  wb: ExcelJS.Workbook,
  items: readonly IngresosDetalleItem[],
  columns: readonly IngresosExcelColumnId[],
): void {
  const sheet = wb.addWorksheet("Detalle de expedientes", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  columns.forEach((id, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = id === "cliente" || id === "asesor" ? 28 : id === "expediente_id" ? 38 : 18;
    applyCell(sheet.getCell(1, i + 1), columnLabel(id), {
      fillArgb: COLORS.headerBlue,
      bold: true,
      fontColor: COLORS.white,
      align: { horizontal: "center", vertical: "middle" },
    });
  });
  sheet.getRow(1).height = 22;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  let r = 2;
  let sumProj = 0;
  let sumReal = 0;
  let sumPend = 0;
  for (const it of items) {
    const fill = (r - 2) % 2 === 0 ? COLORS.alt : COLORS.white;
    columns.forEach((id, i) => {
      const cell = cellForColumn(id, it);
      applyCell(sheet.getCell(r, i + 1), cell.value, {
        fillArgb: fill,
        numFmt: cell.numFmt,
      });
    });
    sumProj += Number(it.ingreso_proyectado ?? 0);
    sumReal += Number(it.ingreso_real ?? 0);
    sumPend += Number(it.pendiente ?? 0);
    r += 1;
  }

  const totalFill = COLORS.total;
  columns.forEach((id, i) => {
    if (i === 0) {
      applyCell(sheet.getCell(r, i + 1), `TOTAL (${items.length} exp.)`, {
        fillArgb: totalFill,
        bold: true,
        fontColor: COLORS.white,
      });
      return;
    }
    if (id === "proyectado") {
      applyCell(sheet.getCell(r, i + 1), Math.round(sumProj * 100) / 100, {
        fillArgb: totalFill,
        bold: true,
        fontColor: COLORS.white,
        numFmt: "$#,##0.00",
      });
      return;
    }
    if (id === "real") {
      applyCell(sheet.getCell(r, i + 1), Math.round(sumReal * 100) / 100, {
        fillArgb: totalFill,
        bold: true,
        fontColor: COLORS.white,
        numFmt: "$#,##0.00",
      });
      return;
    }
    if (id === "pendiente") {
      applyCell(sheet.getCell(r, i + 1), Math.round(sumPend * 100) / 100, {
        fillArgb: totalFill,
        bold: true,
        fontColor: COLORS.white,
        numFmt: "$#,##0.00",
      });
      return;
    }
    applyCell(sheet.getCell(r, i + 1), "", {
      fillArgb: totalFill,
      bold: true,
      fontColor: COLORS.white,
    });
  });
}

function buildBreakdownSheet(
  wb: ExcelJS.Workbook,
  title: string,
  headers: readonly string[],
  rows: readonly (string | number)[][],
  moneyCols: readonly number[],
  pctCols: readonly number[] = [],
): void {
  const sheet = wb.addWorksheet(title, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  headers.forEach((h, i) => {
    sheet.getColumn(i + 1).width = i === 0 ? 32 : 16;
    applyCell(sheet.getCell(1, i + 1), h, {
      fillArgb: COLORS.headerBlue,
      bold: true,
      fontColor: COLORS.white,
      align: { horizontal: "center" },
    });
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  rows.forEach((row, ri) => {
    const fill = ri % 2 === 0 ? COLORS.alt : COLORS.white;
    row.forEach((val, ci) => {
      const money = moneyCols.includes(ci);
      const pct = pctCols.includes(ci);
      applyCell(sheet.getCell(ri + 2, ci + 1), val, {
        fillArgb: fill,
        numFmt: money ? "$#,##0.00" : pct ? "0.00%" : typeof val === "number" ? "#,##0" : undefined,
        align: typeof val === "number" ? { horizontal: "right" } : undefined,
      });
    });
  });
}

export function buildAdminIngresosWorkbook(input: Readonly<{
  config: IngresosExcelExportConfig;
  resumen: IngresosResumen;
  items: readonly IngresosDetalleItem[];
  filterRows: readonly IngresosFilterLabelRow[];
  meta: {
    generatedAtLabel: string;
    actorNombre: string;
    orgNombre: string;
    periodoLabel: string;
    timezone: string;
  };
  /** unused filters kept for future watermarking */
  filters?: IngresosFilters;
}>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ConCasa CRM";
  wb.created = new Date();

  const sheets = new Set<IngresosExcelSheetId>(input.config.sheets);

  if (sheets.has("resumen")) {
    buildResumenSheet(wb, input.resumen, input.meta, input.filterRows);
  }
  if (sheets.has("detalle")) {
    buildDetalleSheet(wb, input.items, input.config.columns);
  }
  if (sheets.has("por_asesor")) {
    const rows = [...input.resumen.por_asesor]
      .sort((a, b) => b.ingreso_proyectado - a.ingreso_proyectado)
      .map((r) => [
        sanitize(r.asesor_nombre),
        r.expedientes,
        r.ingreso_proyectado,
        r.ingreso_real,
        r.pendiente,
        r.cumplimiento_pct / 100,
        r.expedientes > 0
          ? Math.round((r.ingreso_proyectado / r.expedientes) * 100) / 100
          : 0,
      ]);
    buildBreakdownSheet(
      wb,
      "Por asesor",
      [
        "Asesor",
        "Expedientes",
        "Proyectado",
        "Real",
        "Pendiente",
        "Cumplimiento",
        "Ticket promedio",
      ],
      rows,
      [2, 3, 4, 6],
      [5],
    );
  }
  if (sheets.has("por_porcentaje")) {
    const rows = input.resumen.por_porcentaje.map((r) => [
      Number(r.porcentaje_cobro) / 100,
      r.expedientes,
      r.ingreso_proyectado,
      r.ingreso_real,
      Math.max(r.ingreso_proyectado - r.ingreso_real, 0),
    ]);
    buildBreakdownSheet(
      wb,
      "Por porcentaje",
      ["Porcentaje", "Expedientes", "Proyectado", "Real", "Pendiente"],
      rows,
      [2, 3, 4],
      [0],
    );
  }
  if (sheets.has("por_fuente")) {
    const rows = input.resumen.por_fuente_monto.map((r) => [
      fuenteLabel(r.monto_fuente),
      r.expedientes,
      r.ingreso_proyectado,
      r.ingreso_real,
      Math.max(r.ingreso_proyectado - r.ingreso_real, 0),
    ]);
    buildBreakdownSheet(
      wb,
      "Por fuente de monto",
      ["Fuente", "Expedientes", "Proyectado", "Real", "Pendiente"],
      rows,
      [2, 3, 4],
    );
  }
  if (sheets.has("tendencia")) {
    const rows = input.resumen.tendencia.map((t) => [
      sanitize(t.fecha),
      t.proyectado,
      t.real,
      Math.max(t.proyectado - t.real, 0),
      input.items.filter((it) => {
        const d = parseIsoDate(it.fecha_envio_mesa);
        if (!d) return false;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}` === t.fecha;
      }).length,
    ]);
    buildBreakdownSheet(
      wb,
      "Tendencia",
      ["Fecha", "Proyectado", "Real", "Pendiente", "Expedientes"],
      rows,
      [1, 2, 3],
    );
  }
  if (sheets.has("filtros")) {
    const sheet = wb.addWorksheet("Filtros aplicados", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 60;
    applyCell(sheet.getCell(1, 1), "Filtro", {
      fillArgb: COLORS.headerBlue,
      bold: true,
      fontColor: COLORS.white,
    });
    applyCell(sheet.getCell(1, 2), "Valor", {
      fillArgb: COLORS.headerBlue,
      bold: true,
      fontColor: COLORS.white,
    });
    input.filterRows.forEach((fr, i) => {
      const fill = i % 2 === 0 ? COLORS.alt : COLORS.white;
      applyCell(sheet.getCell(i + 2, 1), sanitize(fr.filtro), { fillArgb: fill });
      applyCell(sheet.getCell(i + 2, 2), sanitize(fr.valor), { fillArgb: fill });
    });
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: 2 },
    };
  }

  if (wb.worksheets.length === 0) {
    throw new Error("Selecciona al menos una hoja.");
  }
  return wb;
}

export async function workbookToIngresosArrayBuffer(
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

export async function downloadAdminIngresosWorkbook(
  wb: ExcelJS.Workbook,
  filename: string,
): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("La descarga solo está disponible en el navegador.");
  }
  const buffer = await workbookToIngresosArrayBuffer(wb);
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
