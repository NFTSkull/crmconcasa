import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminReportResponseSchema,
  asesoresCatalogFromReport,
  buildAdminReportRpcPayload,
  detalleForResumenRow,
  expandPasosVisualesToEtapasInternas,
  formatAdminReportMetaSummary,
  groupAdminReportResumenByAsesor,
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
    {
      asesor_id: ASESOR_A,
      asesor_nombre: "Alpha",
      asesor_email: null,
      paso_visual: 6,
      paso_nombre: "Notificación",
      activos: 0,
      rechazados: 1,
      total: 1,
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
    },
    {
      asesor_id: ASESOR_A,
      asesor_nombre: "Alpha",
      asesor_email: null,
      cliente_nombre: "Cliente R",
      nss: "09876543210",
      etapa_actual: 7,
      paso_visual: 6,
      paso_nombre: "Notificación",
      estado: "rechazado",
    },
  ],
  meta: {
    asesores: 2,
    pasos: 2,
    activos: 3,
    rechazados: 2,
    expedientes: 5,
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

  it("NULL/vacío en RPC payload = Todos", () => {
    assert.deepEqual(
      buildAdminReportRpcPayload({
        asesorIds: [],
        pasosVisuales: [],
        estado: "vigentes",
      }),
      {
        p_asesor_ids: null,
        p_pasos_visuales: null,
        p_estado: "vigentes",
      },
    );
    assert.deepEqual(
      buildAdminReportRpcPayload({
        asesorIds: [ASESOR_A],
        pasosVisuales: [3, 6],
        estado: "rechazados",
      }),
      {
        p_asesor_ids: [ASESOR_A],
        p_pasos_visuales: [3, 6],
        p_estado: "rechazados",
      },
    );
  });
});

describe("admin-report-asesores-etapas — agrupación UI", () => {
  it("agrupa por asesor con subtotales y orden de aparición", () => {
    const groups = groupAdminReportResumenByAsesor(sampleReport.resumen);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]?.asesorNombre, "Beta");
    assert.equal(groups[0]?.subtotal, 2);
    assert.equal(groups[1]?.asesorNombre, "Alpha");
    assert.equal(groups[1]?.subtotal, 3);
    assert.equal(groups[1]?.rows.length, 2);
  });

  it("filtra detalle por asesor×paso", () => {
    const row = sampleReport.resumen[1]!;
    const dets = detalleForResumenRow(sampleReport.detalle, row);
    assert.equal(dets.length, 2);
    assert.ok(dets.every((d) => d.paso_visual === 3));
    assert.equal(dets[0]?.nss, "01234567890");
  });

  it("catálogo de asesores y meta legible", () => {
    const catalog = asesoresCatalogFromReport(sampleReport);
    assert.equal(catalog.length, 2);
    assert.equal(catalog[0]?.nombre, "Alpha");
    assert.equal(
      formatAdminReportMetaSummary(sampleReport.meta),
      "2 asesores · 2 etapas · 5 expedientes",
    );
  });

  it("Zod acepta el payload canónico", () => {
    const parsed = adminReportResponseSchema.safeParse(sampleReport);
    assert.equal(parsed.success, true);
  });
});
