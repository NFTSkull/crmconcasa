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
  join(root, "supabase/migrations/20260930203500_admin_precal_over20k_conversion.sql"),
  "utf8",
);

describe("Admin — rendimiento de precalificaciones", () => {
  it("expone una pestaña dedicada y visible desde Admin", () => {
    assert.match(tabs, /id: "precalificaciones"/);
    assert.match(tabs, /label: "Precalificaciones"/);
    assert.match(page, /AdminPrecalPerformanceSection/);
    assert.match(page, /adminTabPanelId\("precalificaciones"\)/);
  });

  it("usa ancho ampliado y la tabla de asesores no fuerza scroll horizontal", () => {
    assert.match(page, /max-w-\[1760px\]/);
    assert.match(panel, /w-full table-fixed/);
    assert.match(panel, /overflow-hidden/);
    assert.doesNotMatch(panel, /min-w-\[1240px\]/);
  });

  it("muestra los KPI solicitados", () => {
    assert.match(panel, /Precalificaciones/);
    assert.match(panel, /NSS compartidos entre asesores/);
    assert.match(panel, /Re-precalificaciones/);
    assert.match(panel, /Monto promedio aprobado/);
    assert.match(panel, /Aprobadas > \$20k/);
    assert.match(panel, /% >\$20k/);
    assert.match(panel, /Topados \$169k/);
    assert.match(panel, /Rendimiento por asesor/);
  });

  it("el read-model evita duplicar editor_decisions cuando existe historial P155", () => {
    assert.match(
      migration,
      /WHERE NOT EXISTS \([\s\S]*expediente_precalificacion_intentos/,
    );
    assert.match(migration, /compartido_entre_asesores/);
    assert.match(migration, /is_reprecalificacion/);
    assert.match(migration, /count\(\*\) FILTER \(WHERE is_reprecalificacion\)/);
    assert.match(migration, /submitted_to_mesa/);
    assert.match(migration, /aprobado_mayor_20k/);
    assert.match(migration, /casos_mayor_20k_en_mesa/);
    assert.match(migration, /conversion_mayor_20k_pct/);
    assert.match(migration, /monto_aprobado, 0\) > 20000/);
    assert.match(migration, /least\(monto_aprobado, 169000\)/);
  });

  it("el detalle separa compartidos, re-precalificaciones, topados y conversión", () => {
    assert.match(panel, /value: "compartidos"/);
    assert.match(panel, /value: "reprecalificaciones"/);
    assert.match(panel, /value: "mayor_20k"/);
    assert.match(panel, /value: "topados"/);
    assert.match(panel, /value: "mesa"/);
    assert.match(panel, /value: "no_mesa"/);
  });
});
