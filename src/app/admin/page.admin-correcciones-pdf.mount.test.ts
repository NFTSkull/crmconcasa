import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Admin correcciones PDF — montaje en /admin", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/admin/page.tsx"),
    "utf8",
  );
  const excel = readFileSync(
    join(process.cwd(), "src/lib/exportAdminProductionExcel.ts"),
    "utf8",
  );
  const repo = readFileSync(
    join(process.cwd(), "src/domain/admin-production/supabase.repo.ts"),
    "utf8",
  );

  it("botón PDF correcciones junto a Descargar Excel", () => {
    assert.match(page, /Descargar Excel/);
    assert.match(page, /Descargar PDF correcciones/);
    assert.match(page, /Generando PDF…/);
    assert.match(page, /exportPdfCorrecciones/);
    const excelIdx = page.indexOf("Descargar Excel");
    const pdfIdx = page.indexOf("Descargar PDF correcciones");
    assert.ok(excelIdx > 0 && pdfIdx > excelIdx);
  });

  it("filtro Corrección + Alcance", () => {
    assert.match(page, /label="Corrección"/);
    assert.match(page, /label="Alcance"/);
    assert.match(page, /ADMIN_CORRECCION_FILTER_OPTIONS/);
    assert.match(page, /ADMIN_CORRECCION_ALCANCE_OPTIONS/);
    assert.match(page, /correccionAlcance/);
    assert.match(page, /periodo_seleccionado/);
    const filterMod = readFileSync(
      join(process.cwd(), "src/domain/admin-production/admin-correccion-filter.ts"),
      "utf8",
    );
    assert.match(filterMod, /pendientes_actuales/);
  });

  it("Excel actual intacto (workbook + exportAll; sin alcance)", () => {
    assert.match(page, /buildAdminProductionWorkbook/);
    assert.match(page, /downloadAdminProductionWorkbook/);
    const excelFn =
      page.match(/const exportExcel = async \(\) => \{[\s\S]*?finally[\s\S]*?\};/)?.[0] ??
      "";
    assert.match(excelFn, /repo\.exportAll\(filtersBase\)/);
    assert.doesNotMatch(excelFn, /listExpedientesSnapshotPage|correccionAlcance/);
    assert.match(excel, /export function buildAdminProductionWorkbook/);
  });

  it("PDF/listado usan loadAdminCorreccionUniverse (periodo o snapshot)", () => {
    assert.match(page, /loadAdminCorreccionUniverse/);
    assert.match(page, /listExpedientesSnapshotPage/);
    assert.match(page, /enrichAdminMesaWithCorreccionDetalle/);
    assert.match(page, /getExpedienteCorreccionDetalle/);
    assert.doesNotMatch(
      page.match(/const exportPdfCorrecciones[\s\S]*?finally[\s\S]*?\};/)?.[0] ??
        "",
      /mesaItems/,
    );
  });

  it("default periodo conserva listMesaEnviosPage; pipeline vía needsAdminCorreccionUniversePipeline", () => {
    assert.match(page, /needsAdminCorreccionUniversePipeline/);
    assert.match(page, /repo\.listMesaEnviosPage\(mesaListFilters\)/);
    assert.match(page, /selectAdminCorreccionRows/);
  });

  it("repo llama RPC canónico parseAsesorCorreccionDetalle", () => {
    assert.match(repo, /asesor_correccion_detalle/);
    assert.match(repo, /parseAsesorCorreccionDetalle/);
    assert.match(repo, /getExpedienteCorreccionDetalle/);
  });

  it("mensaje vacío sin descargar PDF vacío", () => {
    assert.match(page, /ADMIN_CORRECCIONES_PDF_EMPTY_MESSAGE/);
    assert.match(page, /setPdfEmptyMessage\(ADMIN_CORRECCIONES_PDF_EMPTY_MESSAGE\)/);
    const pdfLib = readFileSync(
      join(process.cwd(), "src/lib/exportAdminCorreccionesPdf.ts"),
      "utf8",
    );
    assert.match(
      pdfLib,
      /No hay correcciones pendientes con los filtros seleccionados/,
    );
  });

  it("sin migración SQL nueva para alcance", () => {
    assert.doesNotMatch(page, /CREATE TABLE|supabase\/migrations/);
    const universe = readFileSync(
      join(
        process.cwd(),
        "src/domain/admin-production/admin-correccion-universe.ts",
      ),
      "utf8",
    );
    assert.match(universe, /listExpedientesSnapshotPage|fetchAllAdminSnapshotExpedientes/);
    assert.doesNotMatch(universe, /CREATE TABLE|migration/);
  });
});
