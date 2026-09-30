import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const tabs = readFileSync(join(root, "src/lib/adminUxTabs.ts"), "utf8");
const page = readFileSync(join(root, "src/app/admin/page.tsx"), "utf8");
const panel = readFileSync(
  join(root, "src/components/admin/AdminPrecalificacionesPerformanceSection.tsx"),
  "utf8",
);
const migration = readFileSync(
  join(root, "supabase/migrations/20260930104500_admin_precal_performance.sql"),
  "utf8",
);

describe("Admin panel de rendimiento de precalificaciones", () => {
  it("expone pestaña dedicada y panel separado de Expedientes", () => {
    assert.match(tabs, /id: "precalificaciones"/);
    assert.match(tabs, /label: "Precalificaciones"/);
    assert.match(page, /AdminPrecalificacionesPerformanceSection/);
    assert.match(page, /adminTabPanelId\("precalificaciones"\)/);
  });

  it("muestra funnel, repetidos, montos, topados y conversión a Mesa", () => {
    assert.match(panel, /Precalificaciones/);
    assert.match(panel, /NSS únicos/);
    assert.match(panel, /Re-precalificaciones \/ repetidas/);
    assert.match(panel, /Promedio aprobado Mejoravit/);
    assert.match(panel, /Topados \$169,000/);
    assert.match(panel, /Entraron a trámite/);
    assert.match(panel, /Rendimiento por asesor/);
    assert.match(panel, /Historial NSS/);
  });

  it("read-model cuenta eventos históricos sin inflar conversión por expediente", () => {
    assert.match(migration, /expediente_precalificacion_intentos/);
    assert.match(migration, /count\(DISTINCT b\.expediente_id\)/);
    assert.match(migration, /submitted_to_mesa/);
    assert.match(migration, /nss_precalificaciones_historicas/);
    assert.match(migration, /least\(ev\.monto_original, 169000::NUMERIC\)/);
    assert.match(
      migration,
      /lower\(b\.programa\) = 'mejoravit'/,
    );
    assert.doesNotMatch(migration, /UPDATE public\.expedientes|DELETE FROM public\.expedientes/);
  });
});
