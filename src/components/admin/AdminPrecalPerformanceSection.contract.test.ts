import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const tabs = readFileSync(join(root, "src/lib/adminUxTabs.ts"), "utf8");
const page = readFileSync(join(root, "src/app/admin/page.tsx"), "utf8");
const panel = readFileSync(
  join(root, "src/components/admin/AdminPrecalPerformanceSection.tsx"),
  "utf8",
);
const migration = readFileSync(
  join(root, "supabase/migrations/20260930121000_admin_precal_performance_dashboard.sql"),
  "utf8",
);

describe("Admin — rendimiento de precalificaciones", () => {
  it("expone una pestaña dedicada y visible desde Admin", () => {
    assert.match(tabs, /id: "precalificaciones"/);
    assert.match(tabs, /label: "Precalificaciones"/);
    assert.match(page, /AdminPrecalPerformanceSection/);
    assert.match(page, /adminTabPanelId\("precalificaciones"\)/);
  });

  it("muestra los KPI solicitados", () => {
    assert.match(panel, /Precalificaciones/);
    assert.match(panel, /NSS repetidos/);
    assert.match(panel, /Monto promedio aprobado/);
    assert.match(panel, /Entraron a Mesa/);
    assert.match(panel, /Topados \$169k/);
    assert.match(panel, /Rendimiento por asesor/);
  });

  it("el read-model evita duplicar editor_decisions cuando existe historial P155", () => {
    assert.match(
      migration,
      /WHERE NOT EXISTS \([\s\S]*expediente_precalificacion_intentos/,
    );
    assert.match(migration, /nss_precal_historicas/);
    assert.match(migration, /submitted_to_mesa/);
    assert.match(migration, /least\(monto_aprobado, 169000\)/);
  });

  it("el detalle permite aislar repetidos, topados y conversión", () => {
    assert.match(panel, /value: "repetidos"/);
    assert.match(panel, /value: "topados"/);
    assert.match(panel, /value: "mesa"/);
    assert.match(panel, /value: "no_mesa"/);
  });
});
