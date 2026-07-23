import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import type { AdminReportResponse } from "@/domain/admin-report-asesores-etapas";
import {
  ADMIN_REPORT_EXCEL_COLORS,
  buildAdminReportExpedientesFilename,
  buildAdminReportExpedientesWorkbook,
  todayYmdLocal,
  workbookToAdminReportArrayBuffer,
} from "./exportAdminReportExpedientesExcel";

const ASESOR = "11111111-1111-4111-8111-111111111111";
const ASESOR_B = "22222222-2222-4222-8222-222222222222";

const sample: AdminReportResponse = {
  resumen: [
    {
      asesor_id: ASESOR,
      asesor_nombre: "Ana Asesor",
      asesor_email: "ana@x.com",
      paso_visual: 6,
      paso_nombre: "Notificación",
      activos: 1,
      rechazados: 1,
      total: 2,
    },
    {
      asesor_id: ASESOR_B,
      asesor_nombre: "Beto",
      asesor_email: null,
      paso_visual: 3,
      paso_nombre: "Listo para cita de biométrico",
      activos: 1,
      rechazados: 0,
      total: 1,
    },
  ],
  detalle: [
    {
      asesor_id: ASESOR,
      asesor_nombre: "Ana Asesor",
      asesor_email: "ana@x.com",
      cliente_nombre: "Cliente Activo",
      nss: "01234567890",
      etapa_actual: 7,
      paso_visual: 6,
      paso_nombre: "Notificación",
      estado: "activo",
      fecha_entrada_paso_actual: "2026-07-20",
    },
    {
      asesor_id: ASESOR,
      asesor_nombre: "Ana Asesor",
      asesor_email: "ana@x.com",
      cliente_nombre: "Cliente Rechazado",
      nss: "09876543210",
      etapa_actual: 7,
      paso_visual: 6,
      paso_nombre: "Notificación",
      estado: "rechazado",
      fecha_entrada_paso_actual: "2026-07-18",
    },
    {
      asesor_id: ASESOR_B,
      asesor_nombre: "Beto",
      asesor_email: null,
      cliente_nombre: "Cliente B",
      nss: "00112233445",
      etapa_actual: 3,
      paso_visual: 3,
      paso_nombre: "Listo para cita de biométrico",
      estado: "activo",
      fecha_entrada_paso_actual: null,
    },
  ],
  meta: {
    asesores: 2,
    pasos: 2,
    activos: 2,
    rechazados: 1,
    expedientes: 3,
    sin_fecha_canonica: 1,
    excluidos_por_fecha_desconocida: 0,
  },
};

function fillArgb(cell: ExcelJS.Cell): string {
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  return String(fill?.fgColor?.argb ?? "").toUpperCase();
}

function borderArgb(cell: ExcelJS.Cell): string {
  return String(cell.border?.top?.color?.argb ?? "").toUpperCase();
}

describe("exportAdminReportExpedientesExcel", () => {
  it("filename reporte-expedientes-YYYY-MM-DD.xlsx", () => {
    assert.equal(
      buildAdminReportExpedientesFilename("2026-07-22"),
      "reporte-expedientes-2026-07-22.xlsx",
    );
    assert.throws(() => buildAdminReportExpedientesFilename("22-07-2026"));
  });

  it("todayYmdLocal es YYYY-MM-DD local", () => {
    assert.match(todayYmdLocal(new Date(2026, 6, 22)), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("datos intactos: hojas, columnas, NSS, subtotales, sin UUID", async () => {
    const wb = buildAdminReportExpedientesWorkbook(sample);
    assert.deepEqual(
      wb.worksheets.map((s) => s.name),
      ["Resumen", "Detalle"],
    );

    const resumen = wb.getWorksheet("Resumen")!;
    assert.equal(resumen.getCell(1, 1).value, "Asesor");
    assert.equal(resumen.getCell(1, 2).value, "Etapa");
    assert.equal(resumen.getCell(1, 3).value, "Expedientes");
    assert.equal(resumen.getCell(2, 1).value, "Ana Asesor");
    assert.equal(resumen.getCell(2, 3).value, 2);
    assert.equal(String(resumen.getCell(3, 1).value), "Subtotal · Ana Asesor");
    assert.equal(resumen.getCell(3, 3).value, 2);
    assert.equal(resumen.getCell(4, 1).value, "Beto");
    assert.equal(String(resumen.getCell(5, 1).value), "Subtotal · Beto");
    assert.equal(resumen.getCell(6, 1).value, "TOTAL GENERAL");
    assert.equal(resumen.getCell(6, 3).value, 3);

    const detalle = wb.getWorksheet("Detalle")!;
    assert.equal(detalle.getCell(1, 1).value, "Asesor");
    assert.equal(detalle.getCell(1, 3).value, "NSS");
    assert.equal(detalle.getCell(1, 5).value, "Fecha de entrada al paso");
    assert.equal(detalle.getCell(2, 3).value, "01234567890");
    assert.equal(detalle.getCell(2, 5).value, "2026-07-20");
    assert.equal(detalle.getCell(4, 5).value, "—");
    assert.equal(
      String(detalle.getCell(3, 4).value),
      "Paso 6 · Notificación · Rechazado",
    );

    const buf = await workbookToAdminReportArrayBuffer(wb);
    const flat = Buffer.from(buf).toString("utf8");
    assert.ok(!flat.includes(ASESOR));
    assert.ok(!flat.toLowerCase().includes("telefono"));

    // Resumen total == detalle rows
    assert.equal(sample.meta.expedientes, sample.detalle.length);
  });

  it("P113 estilos oficiales citas: encabezado, alternos, subtotal, bordes, anchos", () => {
    const wb = buildAdminReportExpedientesWorkbook(sample);
    const resumen = wb.getWorksheet("Resumen")!;
    const detalle = wb.getWorksheet("Detalle")!;

    assert.equal(fillArgb(resumen.getCell(1, 1)), ADMIN_REPORT_EXCEL_COLORS.headerBlue);
    assert.equal(fillArgb(resumen.getCell(2, 1)), ADMIN_REPORT_EXCEL_COLORS.altBlue);
    assert.equal(fillArgb(resumen.getCell(3, 1)), ADMIN_REPORT_EXCEL_COLORS.purple);
    assert.equal(fillArgb(resumen.getCell(4, 1)), ADMIN_REPORT_EXCEL_COLORS.white);
    assert.equal(fillArgb(resumen.getCell(6, 1)), ADMIN_REPORT_EXCEL_COLORS.purple);
    assert.equal(borderArgb(resumen.getCell(2, 1)), ADMIN_REPORT_EXCEL_COLORS.border);
    assert.equal(resumen.getColumn(1).width, 30);
    assert.equal(resumen.getColumn(2).width, 48);
    assert.equal(resumen.getColumn(3).width, 22);

    assert.equal(fillArgb(detalle.getCell(1, 1)), ADMIN_REPORT_EXCEL_COLORS.headerBlue);
    assert.equal(fillArgb(detalle.getCell(2, 1)), ADMIN_REPORT_EXCEL_COLORS.altBlue);
    assert.equal(fillArgb(detalle.getCell(3, 1)), ADMIN_REPORT_EXCEL_COLORS.white);
    assert.equal(borderArgb(detalle.getCell(2, 3)), ADMIN_REPORT_EXCEL_COLORS.border);
    assert.equal(detalle.getCell(2, 3).alignment?.horizontal, "center");
    assert.equal(detalle.getCell(2, 3).numFmt, "@");
    assert.equal(detalle.getColumn(1).width, 30);
    assert.equal(detalle.getColumn(2).width, 45);
    assert.equal(detalle.getColumn(3).width, 18);
    assert.equal(detalle.getColumn(4).width, 48);
    assert.equal(detalle.getColumn(5).width, 26);
  });

  it("sanitiza fórmulas en nombres", () => {
    const wb = buildAdminReportExpedientesWorkbook({
      ...sample,
      resumen: [
        {
          ...sample.resumen[0]!,
          asesor_nombre: "=CMD()",
        },
      ],
      detalle: [
        {
          ...sample.detalle[0]!,
          cliente_nombre: "+hijack",
          asesor_nombre: "=CMD()",
        },
      ],
      meta: { ...sample.meta, expedientes: 1, asesores: 1, pasos: 1 },
    });
    const resumen = wb.getWorksheet("Resumen")!;
    assert.equal(String(resumen.getCell(2, 1).value).startsWith("'"), true);
  });
});
