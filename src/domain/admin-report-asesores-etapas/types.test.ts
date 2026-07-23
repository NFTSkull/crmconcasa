import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminReportResponseSchema,
  asesoresCatalogFromReport,
  buildAdminReportRpcPayload,
  canConsultAdminReport,
  detalleForResumenRow,
  expandPasosVisualesToEtapasInternas,
  formatAdminReportMetaSummary,
  groupAdminReportResumenByAsesor,
  validateAdminReportFechaRango,
  validateAdminReportPasos,
  type AdminReportResponse,
} from "./types";

const ASESOR_A = "11111111-1111-4111-8111-111111111111";
const ASESOR_B = "22222222-2222-4222-8222-222222222222";

const sampleReport: AdminReportResponse = {
  resumen: [
    {
      asesor_id: ASESOR_B,
      asesor_nombre: "Beta",
      asesor_email: "b@x.com",
      paso_visual: 6,
      paso_nombre: "Notificación",
      activos: 1,
      rechazados: 1,
      total: 2,
    },
    {
      asesor_id: ASESOR_A,
      asesor_nombre: "Alpha",
      asesor_email: null,
      paso_visual: 3,
      paso_nombre: "Listo para cita de biométrico",
      activos: 2,
      rechazados: 0,
      total: 2,
    },
  ],
  detalle: [
    {
      asesor_id: ASESOR_A,
      asesor_nombre: "Alpha",
      asesor_email: null,
      cliente_nombre: "Cliente 1",
      nss: "01234567890",
      etapa_actual: 3,
      paso_visual: 3,
      paso_nombre: "Listo para cita de biométrico",
      estado: "activo",
      fecha_entrada_paso_actual: "2026-07-20",
    },
    {
      asesor_id: ASESOR_A,
      asesor_nombre: "Alpha",
      asesor_email: null,
      cliente_nombre: "Cliente 2",
      nss: "01234567891",
      etapa_actual: 4,
      paso_visual: 3,
      paso_nombre: "Listo para cita de biométrico",
      estado: "activo",
      fecha_entrada_paso_actual: "2026-07-18",
    },
  ],
  meta: {
    asesores: 2,
    pasos: 2,
    activos: 3,
    rechazados: 1,
    expedientes: 4,
    sin_fecha_canonica: 1,
    excluidos_por_fecha_desconocida: 1,
  },
};

describe("admin-report-asesores-etapas — mapeo y payload", () => {
  it("expande pasos visuales a internas (paso 3 → 3,4)", () => {
    assert.deepEqual(expandPasosVisualesToEtapasInternas([1, 3, 6, 11]), [
      1, 3, 4, 7, 12,
    ]);
  });

  it("valida pasos 1–11", () => {
    assert.equal(validateAdminReportPasos([1, 11]).ok, true);
    assert.equal(validateAdminReportPasos([0]).ok, false);
    assert.equal(validateAdminReportPasos([12]).ok, false);
  });

  it("valida rango de fechas", () => {
    assert.equal(validateAdminReportFechaRango(null, null).ok, true);
    assert.equal(validateAdminReportFechaRango("2026-07-01", "2026-07-10").ok, true);
    assert.equal(validateAdminReportFechaRango("2026-07-10", "2026-07-01").ok, false);
  });

  it("vacío tras limpiar no consulta; payload explícito", () => {
    assert.equal(
      canConsultAdminReport({
        asesorIds: [],
        pasosVisuales: [],
        estado: "vigentes",
        fechaDesde: null,
        fechaHasta: null,
      }),
      false,
    );
    assert.equal(
      canConsultAdminReport({
        asesorIds: [ASESOR_A],
        pasosVisuales: [3],
        estado: "vigentes",
        fechaDesde: "2026-07-01",
        fechaHasta: null,
      }),
      true,
    );
    assert.deepEqual(
      buildAdminReportRpcPayload({
        asesorIds: [ASESOR_A],
        pasosVisuales: [3, 6],
        estado: "rechazados",
        fechaDesde: "2026-07-01",
        fechaHasta: "2026-07-15",
      }),
      {
        p_asesor_ids: [ASESOR_A],
        p_pasos_visuales: [3, 6],
        p_estado: "rechazados",
        p_fecha_desde: "2026-07-01",
        p_fecha_hasta: "2026-07-15",
      },
    );
  });
});

describe("admin-report-asesores-etapas — agrupación UI", () => {
  it("agrupa por asesor con subtotales", () => {
    const groups = groupAdminReportResumenByAsesor(sampleReport.resumen);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.asesorNombre, "Beta");
    assert.equal(groups[1]?.asesorNombre, "Alpha");
  });

  it("filtra detalle por asesor×paso e incluye fecha", () => {
    const row = sampleReport.resumen[1]!;
    const dets = detalleForResumenRow(sampleReport.detalle, row);
    assert.equal(dets.length, 2);
    assert.equal(dets[0]?.fecha_entrada_paso_actual, "2026-07-20");
    assert.equal(dets[0]?.nss, "01234567890");
  });

  it("meta con excluidos por fecha", () => {
    assert.match(
      formatAdminReportMetaSummary(sampleReport.meta),
      /sin fecha histórica excluidos/,
    );
    assert.equal(asesoresCatalogFromReport(sampleReport).length, 2);
  });

  it("Zod acepta payload v2", () => {
    assert.equal(adminReportResponseSchema.safeParse(sampleReport).success, true);
  });
});
