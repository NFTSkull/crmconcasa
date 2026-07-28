import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import {
  recommendedIngresosExcelConfig,
  type IngresosExcelExportConfig,
} from "@/domain/admin-ingresos/export-config";
import type { IngresosDetalleItem, IngresosResumen } from "@/domain/admin-ingresos/types";
import {
  buildAdminIngresosWorkbook,
  buildIngresosExcelFilename,
  workbookToIngresosArrayBuffer,
} from "./exportAdminIngresosExcel";

const resumen: IngresosResumen = {
  ingreso_proyectado: 1000,
  ingreso_real: 400,
  pendiente_por_cobrar: 600,
  cumplimiento_pct: 40,
  expedientes_proyectados: 2,
  expedientes_pagados: 1,
  expedientes_pendientes: 1,
  ticket_promedio_proyectado: 500,
  ticket_promedio_real: 400,
  sin_datos_cobro: {
    total: 0,
    sin_porcentaje: 0,
    sin_monto: 0,
    sin_ambos: 0,
    items: [],
  },
  por_asesor: [
    {
      asesor_id: "11111111-1111-4111-8111-111111111111",
      asesor_nombre: "Ana",
      expedientes: 2,
      ingreso_proyectado: 1000,
      ingreso_real: 400,
      pendiente: 600,
      cumplimiento_pct: 40,
    },
  ],
  por_porcentaje: [
    {
      porcentaje_cobro: 20,
      expedientes: 2,
      ingreso_proyectado: 1000,
      ingreso_real: 400,
    },
  ],
  por_fuente_monto: [
    {
      monto_fuente: "mesa_actualizado",
      expedientes: 2,
      ingreso_proyectado: 1000,
      ingreso_real: 400,
    },
  ],
  por_paso_visual: [{ paso_visual: 3, expedientes: 2, ingreso_proyectado: 1000 }],
  tendencia: [{ fecha: "2026-07-10", proyectado: 1000, real: 400 }],
};

const items: IngresosDetalleItem[] = [
  {
    expediente_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    cliente_nombre: "Cliente A",
    nss: "12345678901",
    asesor_nombre: "Ana",
    etapa_actual: 3,
    paso_visual: 3,
    fecha_envio_mesa: "2026-07-10T15:00:00.000Z",
    monto_base: 5000,
    monto_fuente: "mesa_actualizado",
    porcentaje_cobro: 20,
    ingreso_proyectado: 1000,
    ingreso_real: null,
    pendiente: 1000,
  },
  {
    expediente_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    cliente_nombre: "Cliente B",
    nss: "10987654321",
    asesor_nombre: "Ana",
    etapa_actual: 12,
    paso_visual: 11,
    fecha_envio_mesa: "2026-07-08T15:00:00.000Z",
    pago_concasa_at: "2026-07-20T18:00:00.000Z",
    monto_base: 2000,
    monto_fuente: "datos_generales",
    porcentaje_cobro: 20,
    ingreso_proyectado: 400,
    ingreso_real: 400,
    pendiente: 0,
  },
];

describe("P138 exportAdminIngresosExcel", () => {
  it("nombre de archivo válido con acentos sanitizados", () => {
    const name = buildIngresosExcelFilename({
      now: new Date("2026-07-28T20:15:00"),
      asesorSlug: "Paty Gutiérrez",
      reportName: "cierre julio",
    });
    assert.match(name, /^Ingresos_ConCasa_\d{4}-\d{2}-\d{2}_\d{4}_/);
    assert.ok(!/[<>:"/\\|?*]/.test(name));
    assert.ok(name.endsWith(".xlsx"));
  });

  it("workbook recomendado: hojas, monedas numéricas y totales", async () => {
    const config = recommendedIngresosExcelConfig();
    const wb = buildAdminIngresosWorkbook({
      config,
      resumen,
      items,
      filterRows: [
        { filtro: "Periodo", valor: "01/07/2026 — 28/07/2026" },
        { filtro: "Asesores", valor: "Todos" },
      ],
      meta: {
        generatedAtLabel: "28/07/2026, 04:00 p.m.",
        actorNombre: "Admin",
        orgNombre: "ConCasa",
        periodoLabel: "01/07/2026 — 28/07/2026",
        timezone: "America/Monterrey",
      },
    });
    assert.ok(wb.getWorksheet("Resumen ejecutivo"));
    assert.ok(wb.getWorksheet("Detalle de expedientes"));

    const detalle = wb.getWorksheet("Detalle de expedientes")!;
    const headerCliente = String(detalle.getCell(1, 1).value);
    assert.equal(headerCliente, "Cliente");

    const proyCol = config.columns.indexOf("proyectado") + 1;
    const cell = detalle.getCell(2, proyCol);
    assert.equal(typeof cell.value, "number");
    assert.equal(cell.numFmt, "$#,##0.00");

    const buf = await workbookToIngresosArrayBuffer(wb);
    assert.ok(buf.byteLength > 1000);
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buf);
    assert.ok(reopened.getWorksheet("Resumen ejecutivo"));
  });

  it("personalización agrega hojas opcionales", () => {
    const config: IngresosExcelExportConfig = {
      sheets: ["resumen", "detalle", "por_asesor", "filtros"],
      columns: ["cliente", "proyectado", "real", "pendiente"],
      reportName: "",
    };
    const wb = buildAdminIngresosWorkbook({
      config,
      resumen,
      items,
      filterRows: [{ filtro: "Estado", valor: "Todos elegibles" }],
      meta: {
        generatedAtLabel: "x",
        actorNombre: "Admin",
        orgNombre: "ConCasa",
        periodoLabel: "Todo",
        timezone: "America/Monterrey",
      },
    });
    assert.ok(wb.getWorksheet("Por asesor"));
    assert.ok(wb.getWorksheet("Filtros aplicados"));
  });
});
