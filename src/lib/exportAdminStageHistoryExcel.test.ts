import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import type {
  AdminStageHistoryItem,
  AdminStageHistorySummary,
} from "@/domain/admin-stage-history";
import {
  ADMIN_REPORT_EXCEL_COLORS,
  workbookToAdminReportArrayBuffer,
} from "./exportAdminReportExpedientesExcel";
import {
  buildAdminStageHistoryFilename,
  buildAdminStageHistoryWorkbook,
} from "./exportAdminStageHistoryExcel";

const sampleSummary: AdminStageHistorySummary = {
  totales: {
    total_expedientes_unicos: 1,
    total_visitas: 1,
    entered_count: 1,
    advanced_count: 0,
    current_count: 1,
    rejected_count: 0,
    returned_count: 0,
    avg_duration_seconds: 7200,
    median_duration_seconds: 7200,
  },
  resumen_por_etapa: [
    {
      paso_visual: 6,
      paso_nombre: "Notificación",
      entered_count: 1,
      advanced_count: 0,
      current_count: 1,
      rejected_count: 0,
      returned_count: 0,
      visitas: 1,
      expedientes_unicos: 1,
      avg_duration_seconds: 7200,
      median_duration_seconds: 7200,
      tasa_avance: null,
      tasa_pendiente: 100,
    },
  ],
  generated_at: "2026-08-01T12:00:00.000Z",
  history_coverage_from: "2026-06-15T08:00:00.000Z",
  movimiento: "entrada",
  nota: null,
};

const sampleItem: AdminStageHistoryItem = {
  visita_id: "33333333-3333-4333-8333-333333333333",
  expediente_id: "44444444-4444-4444-8444-444444444444",
  cliente_nombre: "Cliente Demo",
  nss: "****7890",
  asesor_nombre: "Asesor A",
  programa: "mejoravit",
  paso_visual: 6,
  paso_nombre: "Notificación",
  entered_at: "2026-07-01T15:00:00.000Z",
  exited_at: null,
  duration_seconds: 7200,
  resultado: "continua",
  paso_actual: 6,
  etapa_actual: 7,
  actor_nombre: "Mesa User",
};

describe("exportAdminStageHistoryExcel", () => {
  it("filename con fecha local", () => {
    assert.equal(
      buildAdminStageHistoryFilename("2026-08-03"),
      "reporte-historico-etapas-2026-08-03.xlsx",
    );
  });

  it("workbook con dos hojas y estilos", async () => {
    const wb = buildAdminStageHistoryWorkbook({
      summary: sampleSummary,
      items: [sampleItem],
    });
    assert.equal(wb.worksheets.length, 2);
    assert.equal(wb.getWorksheet("Resumen por etapa")?.name, "Resumen por etapa");
    assert.equal(wb.getWorksheet("Historial detallado")?.name, "Historial detallado");

    const resumen = wb.getWorksheet("Resumen por etapa")!;
    assert.equal(resumen.getCell(1, 1).value, "Etapa");
    assert.match(String(resumen.getCell(2, 1).value), /Paso 6/);

    const detalle = wb.getWorksheet("Historial detallado")!;
    assert.equal(detalle.getCell(1, 1).value, "Cliente");
    assert.equal(detalle.getCell(2, 1).value, "Cliente Demo");
    assert.equal(detalle.getCell(2, 2).value, "****7890");
    assert.equal(detalle.getCell(2, 9).value, "Continúa");

    const headerFill = resumen.getCell(1, 1).fill as ExcelJS.FillPattern;
    assert.equal(headerFill.fgColor?.argb, ADMIN_REPORT_EXCEL_COLORS.headerBlue);

    const buf = await workbookToAdminReportArrayBuffer(wb);
    assert.ok(buf.byteLength > 0);
  });

  it("workbook incluye hojas de resultado de cohorte", async () => {
    const wb = buildAdminStageHistoryWorkbook({
      summary: sampleSummary,
      items: [sampleItem],
      cohortSummary: {
        etapas: [
          {
            paso_visual: 2,
            etapa_label: "Registro",
            entered_count: 40,
            advanced_count: 28,
            stayed_count: 9,
            incident_count: 3,
            undetermined_count: 0,
            advance_rate: 70,
            stayed_rate: 22.5,
            avg_advance_duration_seconds: 3600,
            median_advance_duration_seconds: 3000,
          },
        ],
        generated_at: "2026-08-03T12:00:00.000Z",
        history_coverage_from: "2026-07-23T06:00:00.000Z",
      },
      cohortItems: [
        {
          visita_id: "55555555-5555-4555-8555-555555555555",
          expediente_id: "66666666-6666-4666-8666-666666666666",
          cliente_nombre: "Cohorte Demo",
          nss: "****1234",
          asesor_nombre: "Asesor B",
          programa: "mejoravit",
          paso_visual: 2,
          etapa_label: "Registro",
          entered_at: "2026-08-01T15:00:00.000Z",
          exited_at: "2026-08-03T15:00:00.000Z",
          duration_seconds: 172800,
          period_outcome: "advanced",
          resultado_label: "avanzo",
          etapa_siguiente_paso: 3,
          etapa_siguiente_label: "Listo para cita de biométrico",
          paso_actual: 3,
          etapa_actual: 3,
          situacion_actual: "avanzo_en_periodo",
        },
      ],
    });
    assert.equal(wb.worksheets.length, 4);
    assert.ok(wb.getWorksheet("Resultado por etapa"));
    assert.ok(wb.getWorksheet("Detalle de resultados"));
    const res = wb.getWorksheet("Resultado por etapa")!;
    assert.equal(res.getCell(1, 1).value, "Etapa");
    assert.equal(res.getCell(2, 2).value, 40);
    const det = wb.getWorksheet("Detalle de resultados")!;
    assert.equal(det.getCell(2, 1).value, "Cohorte Demo");
    assert.match(String(det.getCell(2, 6).value), /Avanzaron/i);
  });
});
