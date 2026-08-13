import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Admin UX B3 — Dashboard Bernardo (montaje estático).
 */
describe("Admin UX B3 montaje Bernardo en /admin", () => {
  const page = readFileSync(
    join(process.cwd(), "src/app/admin/page.tsx"),
    "utf8",
  );
  const dash = readFileSync(
    join(process.cwd(), "src/components/admin/AdminBernardoDashboard.tsx"),
    "utf8",
  );
  const period = readFileSync(
    join(process.cwd(), "src/lib/adminBernardoPeriod.ts"),
    "utf8",
  );
  const load = readFileSync(
    join(process.cwd(), "src/lib/adminBernardoLoad.ts"),
    "utf8",
  );
  const tabsHelper = readFileSync(
    join(process.cwd(), "src/lib/adminUxTabs.ts"),
    "utf8",
  );
  const tabsUi = readFileSync(
    join(process.cwd(), "src/components/admin/AdminTabs.tsx"),
    "utf8",
  );

  it("botón Bernardo junto a Cerrar sesión", () => {
    const header = page.match(
      /flex items-center gap-3 text-sm[\s\S]*?Cerrar sesión/,
    );
    assert.ok(header, "No se encontró el bloque de acciones del header");
    assert.match(header[0], />\s*Reporte del día\s*</);
    assert.match(header[0], /Cerrar sesión/);
    const bernardoIdx = header[0].indexOf("Reporte del día");
    const logoutIdx = header[0].indexOf("Cerrar sesión");
    assert.ok(bernardoIdx < logoutIdx, "Reporte del día debe ir antes de Cerrar sesión");
  });

  it("Bernardo no aparece en las cuatro pestañas principales", () => {
    assert.doesNotMatch(tabsUi, />\s*Bernardo\s*</);
    assert.equal(
      (tabsHelper.match(/id: "resumen"|id: "expedientes"|id: "reportes"|id: "produccion"/g) ?? [])
        .length >= 4,
      true,
    );
    assert.match(tabsHelper, /"bernardo"/);
    assert.match(tabsHelper, /isAdminBernardoView/);
    assert.doesNotMatch(
      tabsHelper,
      /ADMIN_TABS[\s\S]*id: "bernardo"/,
    );
  });

  it("abre el dashboard con ?adminTab=bernardo y vuelve al panel", () => {
    assert.match(page, /openBernardo/);
    assert.match(page, /closeBernardo/);
    assert.match(page, /handleTabChange\("bernardo"\)/);
    assert.match(page, /AdminBernardoDashboard/);
    assert.match(page, /← Volver al panel Admin|onBack=\{closeBernardo\}/);
    assert.match(page, /bernardoReturnTabRef/);
  });

  it("Hoy es el periodo inicial del dashboard", () => {
    assert.match(dash, /useState<BernardoPeriodPreset>\("hoy"\)/);
    assert.match(period, /case "hoy"/);
    assert.match(period, /case "semana"/);
    assert.match(period, /case "mes_pasado"/);
    assert.match(period, /case "personalizado"/);
  });

  it("KPI Admin muestra Ingresos (mismo cálculo enviadosAMesa)", () => {
    assert.match(page, /title: "Ingresos"/);
    assert.match(page, /summary\?\.enviadosAMesa/);
    assert.match(page, /Expedientes enviados a Mesa/);
    assert.doesNotMatch(page, /title: "Enviados a Mesa"/);
  });

  it("cuatro tarjetas y un solo detalle expandible", () => {
    assert.match(dash, /id: "ingresos"/);
    assert.match(dash, /id: "biometricos"/);
    assert.match(dash, /id: "firmas"/);
    assert.match(dash, /id: "notificaciones"/);
    assert.match(dash, /expanded === m\.id/);
    assert.match(dash, /setExpanded\(\(cur\) => \(cur === id \? null : id\)\)/);
    assert.match(dash, /AdminBernardoDetailPanel/);
  });

  it("fuentes canónicas read-only sin escrituras", () => {
    assert.match(load, /repo\.getSummary/);
    assert.match(load, /listMesaEnviosPage/);
    assert.match(load, /enviadosAMesa/);
    assert.match(load, /bernardo_ops_detail/);
    assert.match(load, /metric: "biometricos"/);
    assert.match(load, /metric: "firmas"/);
    assert.match(load, /metric: "notificaciones"/);
    assert.doesNotMatch(load, /fetchMesaAgendaBookings|get_mesa_agenda_bookings/);
    assert.doesNotMatch(load, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("subtítulos operativos (completados, no agendados)", () => {
    assert.match(dash, /Biométricos completados en el periodo/);
    assert.match(dash, /Firmas completadas en el periodo/);
    assert.match(dash, /Notificaciones enviadas a registro/);
  });

  it("reutiliza drawer B2 vía openTimeline", () => {
    assert.match(page, /onOpenExpediente=\{\(row, trigger\) => void openTimeline\(row, trigger\)\}/);
    assert.match(dash, /bernardoCitaToMesaEnvio|onOpenExpediente/);
    assert.match(page, /AdminExpedienteDrawer/);
  });

  it("periodos Bernardo no mezclan filtros globales del Admin", () => {
    assert.match(tabsHelper, /tab !== "bernardo"/);
    assert.match(page, /adminGlobalFiltersVisible\(activeTab\)/);
    assert.match(dash, /resolveBernardoPeriodBounds/);
    assert.doesNotMatch(dash, /resolveAdminPeriodBounds/);
  });

  it("empty states y Actualizar", () => {
    const detail = readFileSync(
      join(process.cwd(), "src/components/admin/AdminBernardoDetailPanel.tsx"),
      "utf8",
    );
    const periodSel = readFileSync(
      join(
        process.cwd(),
        "src/components/admin/AdminBernardoPeriodSelector.tsx",
      ),
      "utf8",
    );
    assert.match(detail, /No hubo ingresos en este periodo/);
    assert.match(detail, /No hay biométricos completados en este periodo/);
    assert.match(detail, /No hay firmas completadas en este periodo/);
    assert.match(detail, /No hay notificaciones enviadas a registro/);
    assert.match(periodSel, /Actualizar/);
    assert.match(
      periodSel,
      /Selecciona una fecha inicial y una fecha final válidas/,
    );
  });

  it("accesibilidad básica de tarjetas", () => {
    const card = readFileSync(
      join(process.cwd(), "src/components/admin/AdminBernardoMetricCard.tsx"),
      "utf8",
    );
    assert.match(card, /aria-expanded=\{expanded\}/);
    assert.match(card, /aria-controls=/);
    assert.match(card, /focus-visible:ring/);
  });
});
