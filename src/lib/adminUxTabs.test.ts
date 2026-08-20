import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_REPORTES_SUBTABS,
  ADMIN_TAB_QUERY_PARAM,
  ADMIN_TABS,
  adminGlobalFiltersVisible,
  adminTabButtonId,
  adminTabPanelId,
  DEFAULT_ADMIN_REPORTES_SUBTAB,
  DEFAULT_ADMIN_TAB,
  isAdminTabId,
  nextAdminTabIdOnKey,
  parseAdminReportesSubtab,
  parseAdminTabParam,
} from "@/lib/adminUxTabs";

describe("Admin UX B1 — pestañas del panel Admin", () => {
  it("existen exactamente las cuatro pestañas en orden", () => {
    assert.deepEqual(
      ADMIN_TABS.map((t) => t.id),
      ["resumen", "expedientes", "reportes", "produccion"],
    );
    assert.deepEqual(
      ADMIN_TABS.map((t) => t.label),
      ["Resumen", "Expedientes", "Reportes", "Producción"],
    );
  });

  it("Resumen es la pestaña activa por defecto", () => {
    assert.equal(DEFAULT_ADMIN_TAB, "resumen");
    assert.equal(parseAdminTabParam(null), "resumen");
    assert.equal(parseAdminTabParam(undefined), "resumen");
    assert.equal(parseAdminTabParam(""), "resumen");
  });

  it("query param válido conserva la pestaña; inválido cae a Resumen", () => {
    assert.equal(ADMIN_TAB_QUERY_PARAM, "adminTab");
    assert.equal(parseAdminTabParam("expedientes"), "expedientes");
    assert.equal(parseAdminTabParam("reportes"), "reportes");
    assert.equal(parseAdminTabParam("produccion"), "produccion");
    assert.equal(parseAdminTabParam("bernardo"), "bernardo");
    assert.equal(parseAdminTabParam("otra-cosa"), "resumen");
    assert.equal(isAdminTabId("producción"), false);
    assert.equal(isAdminTabId("bernardo"), true);
  });

  it("ids ARIA de tab y tabpanel están vinculados por pestaña", () => {
    for (const t of ADMIN_TABS) {
      assert.equal(adminTabButtonId(t.id), `admin-tab-${t.id}`);
      assert.equal(adminTabPanelId(t.id), `admin-tabpanel-${t.id}`);
    }
  });

  it("navegación por teclado: flechas con wrap, Home y End", () => {
    assert.equal(nextAdminTabIdOnKey("resumen", "ArrowRight"), "expedientes");
    assert.equal(nextAdminTabIdOnKey("produccion", "ArrowRight"), "resumen");
    assert.equal(nextAdminTabIdOnKey("resumen", "ArrowLeft"), "produccion");
    assert.equal(nextAdminTabIdOnKey("reportes", "ArrowLeft"), "expedientes");
    assert.equal(nextAdminTabIdOnKey("reportes", "Home"), "resumen");
    assert.equal(nextAdminTabIdOnKey("expedientes", "End"), "produccion");
    assert.equal(nextAdminTabIdOnKey("resumen", "Enter"), null);
    assert.equal(nextAdminTabIdOnKey("resumen", "Tab"), null);
  });

  it("los filtros globales se muestran en Resumen, Expedientes y Producción; no en Reportes ni Bernardo", () => {
    assert.equal(adminGlobalFiltersVisible("resumen"), true);
    assert.equal(adminGlobalFiltersVisible("expedientes"), true);
    assert.equal(adminGlobalFiltersVisible("produccion"), true);
    assert.equal(adminGlobalFiltersVisible("reportes"), false);
    assert.equal(adminGlobalFiltersVisible("bernardo"), false);
  });

  it("Reportes conserva sus subtabs (histórico por etapas / ingresos)", () => {
    assert.deepEqual(
      ADMIN_REPORTES_SUBTABS.map((s) => s.id),
      ["historico", "ingresos"],
    );
    assert.deepEqual(
      ADMIN_REPORTES_SUBTABS.map((s) => s.label),
      ["Histórico por etapas", "Ingresos"],
    );
    assert.equal(DEFAULT_ADMIN_REPORTES_SUBTAB, "historico");
    assert.equal(parseAdminReportesSubtab("ingresos"), "ingresos");
    assert.equal(parseAdminReportesSubtab("nada"), "historico");
    for (const t of ADMIN_TABS) {
      assert.doesNotMatch(t.description, /cohorte/i);
    }
    for (const s of ADMIN_REPORTES_SUBTABS) {
      assert.doesNotMatch(s.label, /cohorte/i);
    }
  });
});
