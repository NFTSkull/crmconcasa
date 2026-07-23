import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminReportHasFechaRango,
  adminReportShowsEntradaPasoWarning,
  adminReportResponseSchema,
  ADMIN_REPORT_ALL_PASO_VALUES,
  buildAdminReportRpcPayload,
  canConsultAdminReport,
  detalleForResumenRow,
  expandPasosVisualesToEtapasInternas,
  formatAdminReportMetaSummary,
  groupAdminReportResumenByAsesor,
  labelDetalleFechaFiltrada,
  resolveDetalleFechaFiltrada,
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
      fecha_envio_mesa: "2026-06-15",
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
      fecha_envio_mesa: "2026-06-10",
    },
  ],
  meta: {
    asesores: 2,
    pasos: 2,
    activos: 3,
    rechazados: 1,
    expedientes: 4,
    tipo_fecha: "envio_mesa",
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

  it("vacío tras limpiar no consulta; payload v3 con tipo fecha", () => {
    assert.equal(
      canConsultAdminReport({
        asesorIds: [],
        pasosVisuales: [],
        estado: "vigentes",
        tipoFecha: "envio_mesa",
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
        tipoFecha: "envio_mesa",
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
        tipoFecha: "entrada_paso_actual",
        fechaDesde: "2026-07-01",
        fechaHasta: "2026-07-15",
      }),
      {
        p_asesor_ids: [ASESOR_A],
        p_pasos_visuales: [3, 6],
        p_estado: "rechazados",
        p_tipo_fecha: "entrada_paso_actual",
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
    assert.equal(dets[0]?.fecha_envio_mesa, "2026-06-15");
    assert.equal(dets[0]?.nss, "01234567890");
  });

  it("meta distingue etapas consultadas y con resultados", () => {
    const summary = formatAdminReportMetaSummary(sampleReport.meta, {
      asesorIds: [ASESOR_A, ASESOR_B, "33333333-3333-4333-8333-333333333333"],
      pasosVisuales: [3, 6, 11],
    });
    assert.match(summary, /3 asesores seleccionados/);
    assert.match(summary, /3 etapas consultadas/);
    assert.match(summary, /2 etapas con resultados/);
    assert.match(summary, /4 expedientes/);
    assert.match(summary, /1 sin fecha histórica excluidos/);
  });

  it("advertencia histórica solo con entrada_paso_actual + rango", () => {
    assert.equal(
      adminReportShowsEntradaPasoWarning({
        tipoFecha: "envio_mesa",
        fechaDesde: "2026-07-01",
        fechaHasta: null,
      }),
      false,
    );
    assert.equal(
      adminReportShowsEntradaPasoWarning({
        tipoFecha: "entrada_paso_actual",
        fechaDesde: "2026-07-01",
        fechaHasta: null,
      }),
      true,
    );
    assert.equal(
      adminReportShowsEntradaPasoWarning({
        tipoFecha: "entrada_paso_actual",
        fechaDesde: null,
        fechaHasta: null,
      }),
      false,
    );
  });

  it("fecha filtrada y etiqueta según tipo", () => {
    const row = sampleReport.detalle[0]!;
    assert.equal(resolveDetalleFechaFiltrada(row, "envio_mesa"), "2026-06-15");
    assert.equal(
      resolveDetalleFechaFiltrada(row, "entrada_paso_actual"),
      "2026-07-20",
    );
    assert.equal(labelDetalleFechaFiltrada("envio_mesa"), "Fecha de envío a Mesa");
  });

  it("rango activo se detecta sin tocar snapshot", () => {
    assert.equal(
      adminReportHasFechaRango({ fechaDesde: null, fechaHasta: null }),
      false,
    );
    assert.equal(
      adminReportHasFechaRango({ fechaDesde: "2026-07-01", fechaHasta: null }),
      true,
    );
  });

  it("Todas selecciona 11 pasos explícitos", () => {
    assert.equal(ADMIN_REPORT_ALL_PASO_VALUES.length, 11);
    assert.deepEqual([...ADMIN_REPORT_ALL_PASO_VALUES], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("Zod acepta payload v3", () => {
    assert.equal(adminReportResponseSchema.safeParse(sampleReport).success, true);
  });
});
