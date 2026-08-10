import ExcelJS from "exceljs";
import type {
  AdminStageCohortItem,
  AdminStageCohortSummary,
  AdminStageHistoryItem,
  AdminStageHistoryResumenEtapa,
  AdminStageHistorySummary,
} from "@/domain/admin-stage-history";
import {
  formatAdminStageHistoryTimestamp,
  formatDurationSeconds,
  labelAdminStageCohortOutcome,
  labelAdminStageCohortSituacion,
  labelAdminStageHistoryResultado,
} from "@/domain/admin-stage-history";
import { ADMIN_REPORT_EXCEL_COLORS } from "./exportAdminReportExpedientesExcel";
import {
  todayYmdLocal,
  workbookToAdminReportArrayBuffer,
} from "./exportAdminReportExpedientesExcel";

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

export function buildAdminStageHistoryFilename(ymd: string): string {
  const day = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("ymd debe ser YYYY-MM-DD");
  }
  return `reporte-historico-etapas-${day}.xlsx`;
}

export function buildAdminStageHistoryWorkbook(input: Readonly<{
  summary: AdminStageHistorySummary;
  items: readonly AdminStageHistoryItem[];
  cohortSummary?: AdminStageCohortSummary | null;
  cohortItems?: readonly AdminStageCohortItem[];
  consultedMeta?: Readonly<{
    movimiento: string;
    timezone: string;
    fechaDesde: string | null;
    fechaHasta: string | null;
    pasos: readonly number[];
    asesoresCount: number;
    definition: string;
    coverageWarning?: string | null;
  }> | null;
}>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const headerAlign: Partial<ExcelJS.Alignment> = {
    horizontal: "center",
    vertical: "middle",
  };

  const metaSheet = wb.addWorksheet("Consulta", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const metaRows: [string, string | number][] = [
    ["Timezone", input.consultedMeta?.timezone ?? input.summary.timezone ?? "America/Monterrey"],
    ["Tipo de movimiento", input.consultedMeta?.movimiento ?? input.summary.movimiento],
    ["Definición", input.consultedMeta?.definition ?? input.summary.nota ?? ""],
    ["Fecha desde", input.consultedMeta?.fechaDesde ?? input.summary.fecha_desde ?? "—"],
    ["Fecha hasta", input.consultedMeta?.fechaHasta ?? input.summary.fecha_hasta ?? "—"],
    ["Etapas seleccionadas", (input.consultedMeta?.pasos ?? []).join(", ") || "—"],
    ["Asesores seleccionados", input.consultedMeta?.asesoresCount ?? "—"],
    ["Asesor en detalle", "Asesor actual del expediente"],
    ["Cobertura histórica", "Historial de etapas disponible con trazabilidad completa desde el 23/07/2026."],
    [
      "Advertencia cobertura",
      input.consultedMeta?.coverageWarning?.trim()
        ? input.consultedMeta.coverageWarning
        : "—",
    ],
    ["Expedientes únicos", input.summary.totales.total_expedientes_unicos],
    ["Movimientos", input.summary.totales.total_visitas],
    ["Entradas en periodo", input.summary.totales.entered_count],
    ["Avances en periodo", input.summary.totales.advanced_count],
    ["Aún en etapa al cierre", input.summary.totales.current_count],
    ["Filas detalle (misma consulta)", input.items.length],
  ];
  applyDataCell(metaSheet.getCell(1, 1), "Campo", {
    fillArgb: ADMIN_REPORT_EXCEL_COLORS.headerBlue,
    bold: true,
    fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
  });
  applyDataCell(metaSheet.getCell(1, 2), "Valor", {
    fillArgb: ADMIN_REPORT_EXCEL_COLORS.headerBlue,
    bold: true,
    fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
  });
  metaSheet.getColumn(1).width = 28;
  metaSheet.getColumn(2).width = 72;
  metaRows.forEach(([k, v], idx) => {
    const fill =
      idx % 2 === 0
        ? ADMIN_REPORT_EXCEL_COLORS.altBlue
        : ADMIN_REPORT_EXCEL_COLORS.white;
    applyDataCell(metaSheet.getCell(idx + 2, 1), sanitize(String(k)), { fillArgb: fill });
    applyDataCell(metaSheet.getCell(idx + 2, 2), sanitize(String(v)), { fillArgb: fill });
  });

  const resumenSheet = wb.addWorksheet("Resumen por etapa", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const resumenHeaders = [
    "Etapa",
    "Movimientos",
    "Únicos",
    "Entradas en periodo",
    "Avances en periodo",
    "Aún en etapa al cierre",
    "Rechazados",
    "Retrocesos en periodo",
    "Perm. prom.",
    "Perm. mediana",
    "Tasa avance %",
    "Tasa pendiente %",
  ] as const;
  resumenHeaders.forEach((label, idx) => {
    applyDataCell(resumenSheet.getCell(1, idx + 1), label, {
      fillArgb: ADMIN_REPORT_EXCEL_COLORS.headerBlue,
      bold: true,
      fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
      align: headerAlign,
    });
    resumenSheet.getColumn(idx + 1).width = idx === 0 ? 42 : 16;
  });

  input.summary.resumen_por_etapa.forEach((row: AdminStageHistoryResumenEtapa, idx) => {
    const fill =
      idx % 2 === 0
        ? ADMIN_REPORT_EXCEL_COLORS.altBlue
        : ADMIN_REPORT_EXCEL_COLORS.white;
    const r = idx + 2;
    const cells: (string | number)[] = [
      `Paso ${row.paso_visual} · ${row.paso_nombre}`,
      row.visitas,
      row.expedientes_unicos,
      row.entered_count,
      row.advanced_count,
      row.current_count,
      row.rejected_count,
      row.returned_count,
      formatDurationSeconds(row.avg_duration_seconds),
      formatDurationSeconds(row.median_duration_seconds),
      row.tasa_avance ?? "—",
      row.tasa_pendiente ?? "—",
    ];
    cells.forEach((val, colIdx) => {
      applyDataCell(resumenSheet.getCell(r, colIdx + 1), val, {
        fillArgb: fill,
        align: colIdx === 0 ? undefined : { horizontal: "center" },
      });
    });
  });

  const detalleSheet = wb.addWorksheet("Historial detallado", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const detalleHeaders = [
    "Cliente",
    "NSS",
    "Programa",
    "Asesor actual",
    "Expediente ID",
    "Etapa consultada",
    "Origen",
    "Destino",
    "Entrada",
    "Salida / avance",
    "Tiempo en etapa",
    "Tiempo en rango",
    "En etapa al cierre",
    "Resultado",
    "Etapa actual",
    "Actor",
  ] as const;
  detalleHeaders.forEach((label, idx) => {
    applyDataCell(detalleSheet.getCell(1, idx + 1), label, {
      fillArgb: ADMIN_REPORT_EXCEL_COLORS.headerBlue,
      bold: true,
      fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
      align: headerAlign,
    });
    detalleSheet.getColumn(idx + 1).width =
      idx === 0 || idx === 5 ? 30 : idx === 4 ? 38 : idx === 8 || idx === 9 ? 22 : 16;
  });

  input.items.forEach((row, idx) => {
    const fill =
      idx % 2 === 0
        ? ADMIN_REPORT_EXCEL_COLORS.altBlue
        : ADMIN_REPORT_EXCEL_COLORS.white;
    const r = idx + 2;
    const etapaActual =
      row.paso_actual != null
        ? `Paso ${row.paso_actual}`
        : row.etapa_actual != null
          ? `Etapa ${row.etapa_actual}`
          : "—";
    const origen =
      row.paso_origen != null
        ? `Paso ${row.paso_origen}`
        : row.etapa_origen != null
          ? `Etapa ${row.etapa_origen}`
          : "—";
    const destino =
      row.etapa_siguiente_paso != null
        ? `Paso ${row.etapa_siguiente_paso}`
        : row.etapa_siguiente != null
          ? `Etapa ${row.etapa_siguiente}`
          : "—";
    const values: (string | number)[] = [
      sanitize(row.cliente_nombre),
      sanitize(String(row.nss ?? "")),
      sanitize(row.programa ?? "—"),
      sanitize(row.asesor_nombre ?? "—"),
      sanitize(row.expediente_id),
      sanitize(`Paso ${row.paso_visual} · ${row.paso_nombre}`),
      sanitize(origen),
      sanitize(destino),
      formatAdminStageHistoryTimestamp(row.entered_at),
      formatAdminStageHistoryTimestamp(row.exited_at ?? row.movimiento_at),
      formatDurationSeconds(row.duration_seconds),
      formatDurationSeconds(row.duration_in_range_seconds ?? null),
      row.still_in_stage_at_range_end == null
        ? "—"
        : row.still_in_stage_at_range_end
          ? "Sí"
          : "No",
      labelAdminStageHistoryResultado(row.resultado),
      sanitize(etapaActual),
      sanitize(row.actor_nombre ?? "—"),
    ];
    values.forEach((val, colIdx) => {
      applyDataCell(detalleSheet.getCell(r, colIdx + 1), val, {
        fillArgb: fill,
        align: colIdx === 1 ? { horizontal: "center" } : undefined,
        numFmt: colIdx === 1 ? "@" : undefined,
      });
    });
  });

  if (input.cohortSummary) {
    const resultadoSheet = wb.addWorksheet("Resultado por etapa", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const resultadoHeaders = [
      "Etapa",
      "Entraron",
      "Avanzaron",
      "Se quedaron al cierre",
      "Rechazados/retrocedieron",
      "No determinados",
      "Tasa de avance",
      "Tasa de permanencia",
      "Tiempo promedio para avanzar",
      "Tiempo mediano para avanzar",
    ] as const;
    resultadoHeaders.forEach((label, idx) => {
      applyDataCell(resultadoSheet.getCell(1, idx + 1), label, {
        fillArgb: ADMIN_REPORT_EXCEL_COLORS.headerBlue,
        bold: true,
        fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
        align: headerAlign,
      });
      resultadoSheet.getColumn(idx + 1).width = idx === 0 ? 42 : 18;
    });

    input.cohortSummary.etapas.forEach((row, idx) => {
      const fill =
        idx % 2 === 0
          ? ADMIN_REPORT_EXCEL_COLORS.altBlue
          : ADMIN_REPORT_EXCEL_COLORS.white;
      const r = idx + 2;
      const cells: (string | number)[] = [
        `Paso ${row.paso_visual} · ${row.etapa_label}`,
        row.entered_count,
        row.advanced_count,
        row.stayed_count,
        row.incident_count,
        row.undetermined_count,
        row.advance_rate != null ? `${row.advance_rate}%` : "—",
        row.stayed_rate != null ? `${row.stayed_rate}%` : "—",
        formatDurationSeconds(row.avg_advance_duration_seconds),
        formatDurationSeconds(row.median_advance_duration_seconds),
      ];
      cells.forEach((val, colIdx) => {
        applyDataCell(resultadoSheet.getCell(r, colIdx + 1), val, {
          fillArgb: fill,
          align: colIdx === 0 ? undefined : { horizontal: "center" },
        });
      });
    });

    const desgloseSheet = wb.addWorksheet("Desglose por asesor", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const desgloseHeaders = [
      "Etapa",
      "Asesor",
      "Correo del asesor",
      "Entraron",
      "Avanzaron",
      "Se quedaron al cierre",
      "Rechazados/retrocedieron",
      "No determinados",
    ] as const;
    desgloseHeaders.forEach((label, idx) => {
      applyDataCell(desgloseSheet.getCell(1, idx + 1), label, {
        fillArgb: ADMIN_REPORT_EXCEL_COLORS.headerBlue,
        bold: true,
        fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
        align: headerAlign,
      });
      desgloseSheet.getColumn(idx + 1).width =
        idx === 0 ? 30 : idx === 1 ? 28 : idx === 2 ? 28 : 16;
    });
    let desgloseRow = 2;
    input.cohortSummary.etapas.forEach((etapa) => {
      (etapa.por_asesor ?? []).forEach((asesor) => {
        const fill =
          desgloseRow % 2 === 0
            ? ADMIN_REPORT_EXCEL_COLORS.altBlue
            : ADMIN_REPORT_EXCEL_COLORS.white;
        const cells: (string | number)[] = [
          `Paso ${etapa.paso_visual} · ${etapa.etapa_label}`,
          sanitize(asesor.asesor_nombre),
          sanitize(asesor.asesor_email ?? "—"),
          asesor.entered_count,
          asesor.advanced_count,
          asesor.stayed_count,
          asesor.incident_count,
          asesor.undetermined_count,
        ];
        cells.forEach((val, colIdx) => {
          applyDataCell(desgloseSheet.getCell(desgloseRow, colIdx + 1), val, {
            fillArgb: fill,
            align: colIdx < 3 ? undefined : { horizontal: "center" },
          });
        });
        desgloseRow += 1;
      });
    });
    desgloseSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(desgloseRow - 1, 1), column: desgloseHeaders.length },
    };

    const detalleResultado = wb.addWorksheet("Detalle de resultados", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    const detalleResultadoHeaders = [
      "Cliente",
      "NSS",
      "Asesor",
      "Correo del asesor",
      "Programa",
      "Expediente",
      "Etapa",
      "Fecha de entrada",
      "Fecha de salida",
      "Resultado",
      "Etapa siguiente",
      "Etapa actual",
      "Permanencia",
      "Situación actual",
    ] as const;
    const detalleWidths = [35, 16, 28, 28, 14, 38, 30, 21, 21, 18, 30, 30, 14, 35];
    detalleResultadoHeaders.forEach((label, idx) => {
      applyDataCell(detalleResultado.getCell(1, idx + 1), label, {
        fillArgb: ADMIN_REPORT_EXCEL_COLORS.headerBlue,
        bold: true,
        fontColor: ADMIN_REPORT_EXCEL_COLORS.white,
        align: headerAlign,
      });
      detalleResultado.getColumn(idx + 1).width = detalleWidths[idx] ?? 18;
    });
    // Columna NSS como texto antes de escribir valores
    detalleResultado.getColumn(2).numFmt = "@";

    (input.cohortItems ?? []).forEach((row, idx) => {
      const fill =
        idx % 2 === 0
          ? ADMIN_REPORT_EXCEL_COLORS.altBlue
          : ADMIN_REPORT_EXCEL_COLORS.white;
      const r = idx + 2;
      const etapaActual =
        row.paso_actual != null
          ? `Paso ${row.paso_actual}`
          : row.etapa_actual != null
            ? `Etapa ${row.etapa_actual}`
            : "—";
      const nssText = String(row.nss ?? "");
      const values: (string | number)[] = [
        sanitize(row.cliente_nombre),
        nssText,
        sanitize(row.asesor_nombre ?? "—"),
        sanitize(row.asesor_email ?? "—"),
        sanitize(row.programa ?? "—"),
        row.expediente_id,
        sanitize(`Paso ${row.paso_visual} · ${row.etapa_label}`),
        formatAdminStageHistoryTimestamp(row.entered_at),
        formatAdminStageHistoryTimestamp(row.exited_at),
        labelAdminStageCohortOutcome(row.period_outcome),
        sanitize(
          row.etapa_siguiente_label ??
            (row.etapa_siguiente_paso != null
              ? `Paso ${row.etapa_siguiente_paso}`
              : "—"),
        ),
        sanitize(etapaActual),
        formatDurationSeconds(row.duration_seconds),
        labelAdminStageCohortSituacion(row.situacion_actual),
      ];
      values.forEach((val, colIdx) => {
        const cell = detalleResultado.getCell(r, colIdx + 1);
        if (colIdx === 1) {
          cell.numFmt = "@";
          cell.value = typeof val === "string" ? val : String(val);
        } else {
          cell.value = val;
        }
        cell.fill = solidFill(fill);
        cell.border = thinBorder();
        cell.font = {
          name: "Calibri",
          size: 11,
          color: { argb: ADMIN_REPORT_EXCEL_COLORS.text },
        };
        cell.alignment = {
          vertical: "top",
          wrapText: true,
        };
      });
    });
    detalleResultado.autoFilter = {
      from: { row: 1, column: 1 },
      to: {
        row: Math.max((input.cohortItems?.length ?? 0) + 1, 1),
        column: detalleResultadoHeaders.length,
      },
    };
  }

  return wb;
}

export async function downloadAdminStageHistoryWorkbook(
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

export { todayYmdLocal };
