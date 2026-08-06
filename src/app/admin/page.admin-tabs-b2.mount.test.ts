import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Admin UX B2 — montaje estático: tabla simple, drawer, producción expandible,
 * reportes colapsables. Sin cambios de consultas/setters/exportaciones.
 */
describe("Admin UX B2 montaje", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/admin/page.tsx"),
    "utf8",
  );
  const drawer = readFileSync(
    join(process.cwd(), "src/components/admin/AdminExpedienteDrawer.tsx"),
    "utf8",
  );
  const expandable = readFileSync(
    join(process.cwd(), "src/components/admin/AdminExpandableAdvisorRow.tsx"),
    "utf8",
  );
  const collapsible = readFileSync(
    join(process.cwd(), "src/components/admin/AdminCollapsibleSection.tsx"),
    "utf8",
  );
  const reporte = readFileSync(
    join(process.cwd(), "src/components/admin/AdminReporteExpedientesSection.tsx"),
    "utf8",
  );
  const ingresos = readFileSync(
    join(process.cwd(), "src/components/admin/AdminIngresosSection.tsx"),
    "utf8",
  );
  const empty = readFileSync(
    join(process.cwd(), "src/components/admin/AdminEmptyState.tsx"),
    "utf8",
  );

  it("tabla principal muestra columnas simples (Cliente…Acción)", () => {
    assert.match(page, />Cliente</);
    assert.match(page, />Asesor</);
    assert.match(page, />Etapa</);
    assert.match(page, />Situación</);
    assert.match(page, />Última actividad</);
    assert.match(page, />Acción</);
    assert.match(page, /Ver detalle/);
    // Columnas secundarias ya no en thead de la tabla principal
    assert.doesNotMatch(
      page,
      /<th className="py-2 pr-3">Enviado a Mesa<\/th>/,
    );
    assert.doesNotMatch(page, /<th className="py-2 pr-3">Espera actual<\/th>/);
  });

  it("datos secundarios siguen disponibles en el drawer (sin consultas nuevas)", () => {
    assert.match(drawer, /Fecha de envío/);
    assert.match(drawer, /Espera actual/);
    assert.match(drawer, /Corrección/);
    assert.match(drawer, /Siguiente acción/);
    assert.match(drawer, /Seguimiento/);
    assert.match(drawer, /Precalificación/);
    assert.doesNotMatch(drawer, /getExpedienteMesaTimeline|useAdminProductionRepo|fetch\(/);
  });

  it("drawer abre desde Ver detalle (reutiliza openTimeline) y cierra con botón/Escape", () => {
    assert.match(page, /onClick=\{\(e\) => void openTimeline\(r, e\.currentTarget\)\}/);
    assert.match(page, /Ver detalle/);
    assert.match(page, /<AdminExpedienteDrawer/);
    assert.match(drawer, /role="dialog"/);
    assert.match(drawer, /aria-modal="true"/);
    assert.match(drawer, /Cerrar/);
    assert.match(drawer, /Escape/);
  });

  it("foco: trap Tab + retorno al disparador vía closeTimeline existente", () => {
    assert.match(drawer, /focusable/);
    assert.match(drawer, /document\.activeElement === last/);
    assert.match(page, /timelineTriggerRef/);
    assert.match(page, /trigger\?\.focus\(\)/);
  });

  it("abrir/cerrar drawer no toca setters de filtros ni paginación", () => {
    const openStart = page.indexOf("const openTimeline = useCallback");
    const openEnd = page.indexOf("const loadMoreTimeline", openStart);
    assert.ok(openStart >= 0 && openEnd > openStart, "openTimeline block");
    const open = page.slice(openStart, openEnd);
    assert.match(open, /setTimelineOpen\(true\)/);
    for (const s of [
      "setPreset",
      "setAsesorId",
      "setEtapaActual",
      "setEstado",
      "setBuscar",
      "setMesaPage",
      "setPrecalPage",
    ]) {
      assert.doesNotMatch(open, new RegExp(s));
    }
    const closeStart = page.indexOf("const closeTimeline = useCallback");
    const closeEnd = page.indexOf("const openTimeline", closeStart);
    assert.ok(closeStart >= 0 && closeEnd > closeStart, "closeTimeline block");
    const close = page.slice(closeStart, closeEnd);
    for (const s of ["setPreset", "setAsesorId", "setMesaPage", "setBuscar"]) {
      assert.doesNotMatch(close, new RegExp(s));
    }
  });

  it("Abrir expediente completo conserva /admin/[id]", () => {
    assert.match(drawer, /href=\{`\/admin\/\$\{row\.expedienteId\}`\}/);
    assert.match(drawer, /Abrir expediente completo/);
    assert.match(drawer, /Abrir pantalla completa/);
  });

  it("seguimiento sigue accesible (misma carga timeline)", () => {
    assert.match(page, /repo\.getExpedienteMesaTimeline/);
    assert.match(page, /loadMoreTimeline/);
    assert.match(drawer, /timelineItems\.map/);
    assert.match(drawer, /Cargar más/);
  });

  it("Producción usa filas expandibles y Ver expedientes aplica asesor + pestaña", () => {
    assert.match(page, /AdminExpandableAdvisorRow/);
    assert.match(page, /expandedAsesorId/);
    assert.match(page, /goExpedientesAsesor/);
    assert.match(page, /Ver expedientes de este asesor/);
    assert.match(
      page,
      /applyAsesorFilter\(id\);\s*handleTabChange\("expedientes"\)/,
    );
    assert.match(expandable, /aria-expanded=\{expanded\}/);
    assert.match(expandable, /Expandir|Ocultar/);
  });

  it("Reportes dejan detalle colapsado inicialmente (AdminCollapsibleSection defaultOpen=false)", () => {
    assert.match(collapsible, /defaultOpen = false/);
    assert.match(reporte, /AdminCollapsibleSection/);
    assert.match(reporte, /title="Resumen por etapa"/);
    assert.match(reporte, /title="Detalle de visitas"/);
    assert.match(reporte, /defaultOpen=\{false\}/);
    assert.match(ingresos, /title="Desgloses"/);
    assert.match(ingresos, /Detalle tabular/);
    assert.match(ingresos, /defaultOpen=\{false\}/);
  });

  it("empty states amigables montados", () => {
    assert.match(page, /AdminEmptyState/);
    assert.match(page, /No hay expedientes con estos filtros/);
    assert.match(page, /No hay resultados para este periodo/);
    assert.match(empty, /Limpiar filtros/);
    assert.match(drawer, /No hay actividad registrada/);
  });

  it("sin nuevas consultas: mismos repos y export intactos", () => {
    assert.match(page, /repo\.getSummary\(filtersBase\)/);
    assert.match(page, /repo\.listByAsesor\(filtersBase\)/);
    assert.match(page, /repo\.listExpedientesSnapshotPage\(snapshotListFilters\)/);
    assert.match(page, /repo\.exportAll/);
    assert.match(page, /Descargar Excel/);
    assert.doesNotMatch(page, /fetch\(['"`]\/api/);
  });

  it("responsive: overflow-x solo en tablas; drawer full en móvil / ~50% desktop", () => {
    assert.match(drawer, /w-full/);
    assert.match(drawer, /md:w-\[50%\]/);
    assert.match(page, /overflow-x-auto/);
    assert.doesNotMatch(page, /overflow-x-scroll.*min-h-screen|min-h-screen.*overflow-x/);
  });
});
