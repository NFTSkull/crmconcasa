import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Admin UX B1 — montaje de la reorganización en 4 pestañas.
 * Verifica por análisis estático que la página Admin conserva todos los
 * módulos y comportamientos existentes, solo reorganizados visualmente.
 */
describe("Admin UX B1 montaje en /admin", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/admin/page.tsx"),
    "utf8",
  );
  const tabs = readFileSync(
    join(process.cwd(), "src/components/admin/AdminTabs.tsx"),
    "utf8",
  );
  const sectionHeader = readFileSync(
    join(process.cwd(), "src/components/admin/AdminSectionHeader.tsx"),
    "utf8",
  );

  it("la página monta AdminTabs con estado activo y handler", () => {
    assert.match(page, /import\s+\{\s*AdminTabs\s*\}/);
    assert.match(page, /<AdminTabs active=\{activeTab\} onChange=\{handleTabChange\} \/>/);
  });

  it("hay un tabpanel por pestaña, oculto con hidden (contenido montado, sin duplicar consultas)", () => {
    for (const id of ["resumen", "expedientes", "reportes", "produccion"]) {
      assert.match(
        page,
        new RegExp(
          `id=\\{adminTabPanelId\\("${id}"\\)\\}[\\s\\S]{0,120}hidden=\\{activeTab !== "${id}"\\}`,
        ),
        `Falta tabpanel oculto por hidden para ${id}`,
      );
    }
    // Los paneles usan hidden (siguen montados): no se pierde estado al cambiar.
    assert.doesNotMatch(page, /activeTab === "reportes" \? \(\s*<AdminReporteExpedientesSection/);
  });

  it("cambiar de pestaña no reinicia filtros (handler solo cambia tab y query param)", () => {
    const handler = page.match(
      /const handleTabChange = useCallback\(\(tab: AdminTabId\) => \{[\s\S]*?\}, \[\]\);/,
    );
    assert.ok(handler, "No se encontró handleTabChange");
    assert.match(handler[0], /setActiveTab\(/);
    assert.match(handler[0], /return tab/);
    assert.match(handler[0], /replaceState/);
    for (const setter of [
      "setPreset",
      "setAsesorId",
      "setEtapaActual",
      "setEstado",
      "setBuscar",
      "setPrecalDecision",
    ]) {
      assert.doesNotMatch(
        handler[0],
        new RegExp(setter),
        `handleTabChange no debe tocar ${setter}`,
      );
    }
  });

  it("query param visual ?adminTab= se lee al montar y se valida", () => {
    assert.match(page, /ADMIN_TAB_QUERY_PARAM/);
    assert.match(page, /parseAdminTabParam\(param\)/);
  });

  it("Resumen: KPIs, snapshot por etapas y accesos rápidos", () => {
    assert.match(page, /title: "Ingresos"|Expedientes enviados a Mesa/);
    assert.match(page, /summary\?\.enviadosAMesa/);
    assert.match(page, /Monto Mejoravit|Monto aprobado Mejoravit/);
    assert.match(page, /Estado actual de los expedientes enviados a Mesa/);
    assert.match(page, /Accesos rápidos/);
    assert.match(page, /onEtapaCardPress/);
  });

  it("Expedientes: tabla de Mesa con seguimiento y precalificaciones", () => {
    assert.match(page, /Expedientes del flujo operativo de Mesa/);
    assert.match(page, /Ver detalle/);
    assert.match(page, /openTimeline/);
    assert.match(page, /AdminExpedienteDrawer|Precalificaciones/);
    assert.match(page, /listPrecalificacionesPage|precalItems/);
  });

  it("Reportes: subtabs internos sin jerga técnica visible", () => {
    assert.match(page, /ADMIN_REPORTES_SUBTABS\.map/);
    assert.match(page, /<AdminReporteExpedientesSection \/>/);
    assert.match(page, /<AdminIngresosSection/);
    assert.match(page, /hidden=\{reportesSubtab !== "historico"\}/);
    assert.match(page, /hidden=\{reportesSubtab !== "ingresos"\}/);
    assert.doesNotMatch(page, /cohorte/i);
  });

  it("Producción siempre visible: filtra por row.etapas sin ocultar la tabla", () => {
    assert.match(page, /\{produccionTitle\}/);
    assert.match(page, /filterAdminProductionRowsByPaso|produccionRows/);
    assert.doesNotMatch(page, /showProduccionPorAsesor/);
    assert.doesNotMatch(
      page,
      /Quita el filtro de etapa para ver la tabla/,
    );
    assert.match(page, /clearEtapaFilter/);
  });

  it("acciones y exportaciones existentes siguen renderizadas", () => {
    assert.match(page, /Descargar Excel/);
    assert.match(page, /exportExcel/);
    assert.match(page, /Limpiar filtros/);
    assert.match(page, /applyAsesorFilter/);
    assert.match(page, /Cerrar sesión/);
  });

  it("clic en etapa lleva a Expedientes y enfoca la tabla (comportamiento previo conservado)", () => {
    assert.match(page, /handleTabChange\("expedientes"\)/);
    assert.match(page, /focusMesaExpedientes/);
  });

  it("AdminTabs implementa el patrón ARIA con teclado (roving tabindex)", () => {
    assert.match(tabs, /role="tablist"/);
    assert.match(tabs, /role="tab"/);
    assert.match(tabs, /aria-selected=\{selected\}/);
    assert.match(tabs, /aria-controls=\{adminTabPanelId\(t\.id\)\}/);
    assert.match(tabs, /tabIndex=\{focusable \? 0 : -1\}/);
    assert.match(tabs, /nextAdminTabIdOnKey/);
  });

  it("responsive: tablist y tablas grandes con scroll horizontal, sin overflow de página", () => {
    assert.match(tabs, /overflow-x-auto/);
    const overflowTables = page.match(/overflow-x-auto/g) ?? [];
    assert.ok(
      overflowTables.length >= 2,
      "Las tablas grandes deben conservar overflow-x-auto",
    );
  });

  it("encabezados de módulo usan AdminSectionHeader (título + descripción)", () => {
    assert.match(sectionHeader, /titleId/);
    assert.match(sectionHeader, /trailing/);
    assert.match(page, /<AdminSectionHeader/);
    assert.match(page, /titleId="admin-mesa-expedientes-title"/);
  });

  it("sin cambios técnicos: mismos repos; Expedientes usa periodo", () => {
    assert.match(page, /useAdminProductionRepo/);
    assert.match(page, /repo\.getSummary\(filtersBase\)/);
    assert.match(page, /repo\.listByAsesor\(filtersBase\)/);
    assert.match(page, /repo\.getExpedientesSnapshotEtapas\(snapshotFiltersBase\)/);
    assert.match(page, /repo\.listMesaEnviosPage\(mesaListFilters\)/);
    assert.doesNotMatch(page, /listExpedientesSnapshotPage/);
    assert.match(page, /repo\.getExpedienteMesaTimeline/);
    assert.match(page, /repo\.exportAll/);
  });
});
