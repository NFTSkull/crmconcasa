import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIngresosFilterLabelRows,
  moveIngresosExcelColumn,
  recommendedIngresosExcelConfig,
  validateIngresosExcelConfig,
} from "./export-config";

describe("P138 ingresos excel export config", () => {
  it("configuración recomendada incluye resumen y detalle con columnas default", () => {
    const cfg = recommendedIngresosExcelConfig();
    assert.ok(cfg.sheets.includes("resumen"));
    assert.ok(cfg.sheets.includes("detalle"));
    assert.ok(cfg.columns.includes("cliente"));
    assert.ok(cfg.columns.includes("proyectado"));
    assert.ok(!cfg.columns.includes("expediente_id"));
    assert.equal(validateIngresosExcelConfig(cfg).ok, true);
  });

  it("bloquea sin hojas y detalle sin columnas", () => {
    assert.equal(
      validateIngresosExcelConfig({ sheets: [], columns: ["cliente"], reportName: "" }).ok,
      false,
    );
    assert.equal(
      validateIngresosExcelConfig({
        sheets: ["detalle"],
        columns: [],
        reportName: "",
      }).ok,
      false,
    );
  });

  it("restaurar y mover columnas", () => {
    const base = recommendedIngresosExcelConfig();
    const moved = moveIngresosExcelColumn(base.columns, base.columns[1]!, "up");
    assert.equal(moved[0], base.columns[1]);
    assert.equal(moved[1], base.columns[0]);
  });

  it("filas de filtros reflejan asesores y alcance", () => {
    const rows = buildIngresosFilterLabelRows({
      filters: {
        fechaDesde: "2026-07-01",
        fechaHasta: "2026-07-28",
        asesorIds: ["a"],
        montoFuente: "todas",
        porcentajes: [],
        stageScope: "from_step",
        visibleStep: 4,
        estado: "pendientes",
        buscar: "",
      },
      asesorNombres: ["Paty Gutierrez"],
      alcanceLabel: "Desde Paso 4 en adelante",
      periodoLabel: "01/07/2026 — 28/07/2026",
    });
    assert.equal(rows.find((r) => r.filtro === "Asesores")?.valor, "Paty Gutierrez");
    assert.match(rows.find((r) => r.filtro === "Alcance")?.valor ?? "", /Paso 4/);
    assert.equal(rows.find((r) => r.filtro === "Estado")?.valor, "Pendientes por cobrar");
  });
});
