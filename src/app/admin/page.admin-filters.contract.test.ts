import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ADMIN_FILTER_MATRIX } from "@/domain/admin-production/admin-ui-filters";
import { resolveAdminPeriodBounds } from "@/domain/admin-production/period";
import { etapaActualesFromAdminPasoFilter } from "@/domain/admin-production/admin-ui-filters";

/**
 * Admin filter fix — contratos E1–E8 y R1 (source + helpers).
 * Expedientes = listMesaEnviosPage(bounds); Resumen = snapshot; 0 «cohorte» UI.
 */
describe("Admin filters contract E1-E8 R1", () => {
  const page = readFileSync(join(process.cwd(), "src/app/admin/page.tsx"), "utf8");
  const tabs = readFileSync(join(process.cwd(), "src/lib/adminUxTabs.ts"), "utf8");

  it("E1–E4 Expedientes usa listMesaEnviosPage con mesaListFilters (bounds)", () => {
    assert.match(page, /const mesaListFilters = useMemo/);
    assert.match(page, /\.\.\.filtersBase/);
    assert.match(page, /repo\.listMesaEnviosPage\(mesaListFilters\)/);
    assert.doesNotMatch(page, /listExpedientesSnapshotPage/);
    assert.match(page, /loadExpedientesPeriodo/);
  });

  it("E5 empty state sin fallback snapshot", () => {
    assert.match(
      page,
      /No hay expedientes enviados a Mesa en el periodo seleccionado/,
    );
    assert.doesNotMatch(page, /fallback.*snapshot|snapshotListFilters/);
  });

  it("E6 etapaActuales nace en filtersBase y gobierna Resumen/Expedientes/Producción/Precal", () => {
    const blockStart = page.indexOf("const filtersBase = useMemo");
    const blockEnd = page.indexOf("const snapshotFiltersBase", blockStart);
    assert.ok(blockStart >= 0 && blockEnd > blockStart);
    const block = page.slice(blockStart, blockEnd);
    assert.match(block, /etapaActualesFromAdminPasoFilter\(etapaActual\)/);
    assert.match(block, /etapaActuales/);
    assert.match(block, /etapaActual:/);
    assert.deepEqual(etapaActualesFromAdminPasoFilter("3"), [3, 4]);

    const mesaStart = page.indexOf("const mesaListFilters = useMemo");
    const mesaEnd = page.indexOf("useEffect(() =>", mesaStart);
    const mesa = page.slice(mesaStart, mesaEnd);
    assert.match(mesa, /\.\.\.filtersBase/);
  });

  it("E7 Resumen snapshot independiente del periodo", () => {
    assert.match(page, /repo\.getExpedientesSnapshotEtapas\(snapshotFiltersBase\)/);
    assert.equal(ADMIN_FILTER_MATRIX.resumenSnapshot.periodo, false);
    const snapStart = page.indexOf("const loadSnapshot = useCallback");
    const snapEnd = page.indexOf("const loadExpedientesPeriodo", snapStart);
    const snap = page.slice(snapStart, snapEnd);
    assert.doesNotMatch(snap, /listMesaEnviosPage|bounds/);
  });

  it("E8 Precal usa filtersBase + periodo + etapa", () => {
    assert.match(page, /listPrecalificacionesPage\(\{\s*\n\s*\.\.\.filtersBase/);
    assert.equal(ADMIN_FILTER_MATRIX.precal.periodo, true);
    assert.equal(ADMIN_FILTER_MATRIX.precal.etapa, true);
  });

  it("period bounds helpers: hoy/semana/mes/personalizado", () => {
    const hoy = resolveAdminPeriodBounds({ preset: "hoy" });
    assert.ok(hoy.fromIso < hoy.toExclusiveIso);
    const sem = resolveAdminPeriodBounds({ preset: "semana" });
    assert.ok(sem.fromIso < sem.toExclusiveIso);
    const mes = resolveAdminPeriodBounds({ preset: "mes" });
    assert.ok(mes.fromIso < mes.toExclusiveIso);
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
    assert.doesNotMatch(page, /cohorte/i);
    assert.doesNotMatch(tabs, /label:.*"Histórico y cohorte"/);
    assert.match(tabs, /Histórico por etapas/);
    assert.match(tabs, /Histórico por etapas e ingresos/);
  });

  it("Admin proyección: sin Cita para firma; buckets proyectados", () => {
    assert.match(page, /projectAdminVisibleStageBuckets/);
    assert.match(page, /getAdminEtapaDisplayNombre/);
    assert.match(page, /visibleByEtapa\.map/);
    assert.doesNotMatch(
      page,
      /getEtapaOperativaNombre\(b\.etapa\)/,
    );
  });

  it("matriz: Expedientes, Producción y Precal respetan etapa", () => {
    assert.equal(ADMIN_FILTER_MATRIX.expedientesPeriodo.periodo, true);
    assert.equal(ADMIN_FILTER_MATRIX.expedientesPeriodo.etapa, true);
    assert.equal(ADMIN_FILTER_MATRIX.produccion.periodo, true);
    assert.equal(ADMIN_FILTER_MATRIX.produccion.etapa, true);
    assert.equal(ADMIN_FILTER_MATRIX.precal.etapa, true);
  });
});
