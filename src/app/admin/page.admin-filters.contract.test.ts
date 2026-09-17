import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ADMIN_FILTER_MATRIX } from "@/domain/admin-production/admin-ui-filters";
import { resolveAdminPeriodBounds } from "@/domain/admin-production/period";
import { etapaActualesFromAdminPasoFilter } from "@/domain/admin-production/admin-ui-filters";

describe("Admin filters contract E1-E9 R1", () => {
  const page = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf8");
  const component = readFileSync(
    join(process.cwd(), "src/components/admin/AdminResumenEtapasActividad.tsx"),
    "utf8",
  );
  const tabs = readFileSync(join(process.cwd(), "src/lib/adminUxTabs.ts"), "utf8");

  it("E1–E4 Expedientes usa listMesaEnviosPage con mesaListFilters (bounds)", () => {
    assert.match(page, /const mesaListFilters = useMemo/);
    assert.match(page, /\.\.\.filtersBase/);
    assert.match(page, /repo\.listMesaEnviosPage\(mesaListFilters\)/);
    assert.doesNotMatch(page, /listExpedientesSnapshotPage/);
    assert.match(page, /loadExpedientesPeriodo/);
  });

  it("E5 empty state sin fallback snapshot", () => {
    assert.match(page, /No hay expedientes enviados a Mesa en el periodo seleccionado/);
    assert.doesNotMatch(page, /fallback.*snapshot|snapshotListFilters/);
  });

  it("E6 etapa gobierna listados operativos pero no los cinco KPIs generales", () => {
    const blockStart = page.indexOf("const filtersBase = useMemo");
    const blockEnd = page.indexOf("const periodStageFiltersBase", blockStart);
    assert.ok(blockStart >= 0 && blockEnd > blockStart);
    const block = page.slice(blockStart, blockEnd);
    assert.match(block, /etapaActualesFromAdminPasoFilter\(etapaActual\)/);
    assert.match(block, /etapaActuales/);
    assert.deepEqual(etapaActualesFromAdminPasoFilter("3"), [3, 4]);

    assert.match(page, /repo\.getSummary\(periodStageFiltersBase\)/);
    assert.doesNotMatch(page, /repo\.getSummary\(filtersBase\)/);
    assert.match(page, /Estas cinco métricas muestran el periodo completo/);
  });

  it("E7 resumen usa periodo y una sola numeración Admin de 10 etapas", () => {
    assert.match(page, /repo\.getMesaCohortByEtapa\(periodStageFiltersBase\)/);
    assert.equal(ADMIN_FILTER_MATRIX.resumenEtapasPeriodo.periodo, true);
    assert.equal(ADMIN_FILTER_MATRIX.resumenEtapasPeriodo.etapa, false);
    assert.match(page, /<AdminResumenEtapasActividad/);
    assert.match(page, /cohortBuckets=\{byEtapa\}/);
    assert.match(component, /ADMIN_VISIBLE_STAGES\.map/);
    assert.match(component, /mapEtapaInternaAAdminPaso\(bucket\.etapa\)/);
    assert.match(component, /by_paso_admin/);
    assert.match(component, /TOTAL_PASOS_ADMIN_VISIBLES/);
  });

  it("E8 Precal usa filtersBase + periodo + etapa", () => {
    assert.match(page, /listPrecalificacionesPage\(\{\s*\n\s*\.\.\.filtersBase/);
    assert.equal(ADMIN_FILTER_MATRIX.precal.periodo, true);
    assert.equal(ADMIN_FILTER_MATRIX.precal.etapa, true);
  });

  it("E9 click de etapa siempre hace drill-down preservando periodo", () => {
    const start = page.indexOf("const onEtapaCardPress");
    const end = page.indexOf("const applyAsesorFilter", start);
    const block = page.slice(start, end);
    assert.match(block, /nextPasoVisualFilterFromInternalCard\("todas", etapa\)/);
    assert.match(block, /handleTabChange\("expedientes"\)/);
    assert.match(page, /Periodo: <strong className="font-semibold tabular-nums">\{periodoLabel\}<\/strong>/);
  });

  it("period bounds helpers: hoy/semana/mes/personalizado", () => {
    const custom = resolveAdminPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-08-01",
      customToInclusive: "2026-08-20",
    });
    assert.equal(custom.fromDate, "2026-08-01");
    assert.equal(custom.toDateInclusive, "2026-08-20");
    assert.match(custom.toExclusiveIso, /2026-08-21/);
  });

  it("R1 UI visible sin la palabra cohorte", () => {
    assert.doesNotMatch(page, />[^<]*cohorte[^<]*</i);
    assert.doesNotMatch(component, />[^<]*cohorte[^<]*</i);
    assert.doesNotMatch(tabs, /label:.*"Histórico y cohorte"/);
  });

  it("Resumen enfoca la etapa seleccionada sin alterar la base del periodo", () => {
    assert.match(component, /const selectedStage = useMemo/);
    assert.match(component, /ADMIN_VISIBLE_STAGES\.find/);
    assert.match(page, /selectedInternalStages=\{etapaActualesSeleccionadas\}/);
    assert.match(component, /Paso \{selectedStage\.pasoAdmin\} de \{TOTAL_PASOS_ADMIN_VISIBLES\}/);
  });

  it("matriz: Expedientes, Producción y Precal respetan etapa", () => {
    assert.equal(ADMIN_FILTER_MATRIX.expedientesPeriodo.periodo, true);
    assert.equal(ADMIN_FILTER_MATRIX.expedientesPeriodo.etapa, true);
    assert.equal(ADMIN_FILTER_MATRIX.produccion.periodo, true);
    assert.equal(ADMIN_FILTER_MATRIX.produccion.etapa, true);
    assert.equal(ADMIN_FILTER_MATRIX.precal.etapa, true);
  });
});
