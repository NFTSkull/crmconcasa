import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import type { AdminReportResponse } from "@/domain/admin-report-asesores-etapas";
import {
  buildAdminReportExpedientesFilename,
  buildAdminReportExpedientesWorkbook,
  todayYmdLocal,
} from "./exportAdminReportExpedientesExcel";

const ASESOR = "11111111-1111-4111-8111-111111111111";

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
    },
  ],
  meta: {
    asesores: 1,
    pasos: 1,
    activos: 1,
    rechazados: 1,
    expedientes: 2,
  },
};

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

  it("workbook Resumen + Detalle; NSS texto; rechazo marcado; sin UUID", () => {
    const wb = buildAdminReportExpedientesWorkbook(sample);
    assert.deepEqual(wb.SheetNames, ["Resumen", "Detalle"]);

    const resumen = XLSX.utils.sheet_to_json<(string | number)[]>(
      wb.Sheets.Resumen!,
      { header: 1 },
    );
    assert.deepEqual(resumen[0], ["Asesor", "Etapa", "Expedientes"]);
    assert.equal(resumen[1]?.[0], "Ana Asesor");
    assert.equal(resumen[1]?.[2], 2);
    assert.equal(String(resumen[2]?.[0]), "Subtotal · Ana Asesor");
    assert.equal(resumen[3]?.[0], "TOTAL GENERAL");
    assert.equal(resumen[3]?.[2], 2);

    const detalle = XLSX.utils.sheet_to_json<(string | number)[]>(
      wb.Sheets.Detalle!,
      { header: 1 },
    );
    assert.deepEqual(detalle[0], ["Asesor", "Cliente", "NSS", "Paso actual"]);
    assert.equal(detalle[1]?.[2], "01234567890");
    assert.equal(String(detalle[2]?.[3]), "Paso 6 · Notificación · Rechazado");

    const nssCell = wb.Sheets.Detalle!["C2"];
    assert.equal(nssCell?.t, "s");
    assert.equal(nssCell?.z, "@");

    const flat = JSON.stringify(wb);
    assert.ok(!flat.includes(ASESOR));
    assert.ok(!flat.toLowerCase().includes("telefono"));
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
    });
    const resumen = XLSX.utils.sheet_to_json<(string | number)[]>(
      wb.Sheets.Resumen!,
      { header: 1 },
    );
    assert.equal(String(resumen[1]?.[0]).startsWith("'"), true);
  });
});
