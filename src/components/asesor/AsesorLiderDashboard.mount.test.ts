import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("AsesorLiderDashboard montaje", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/asesor/AsesorLiderDashboard.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/page.tsx"),
    "utf8",
  );

  it("muestra KPIs Activos/Cerrados/Total y acciones", () => {
    assert.match(src, /Activos/);
    assert.match(src, /Cerrados/);
    assert.match(src, /Total/);
    assert.match(src, /Agregar Cliente/);
    assert.match(src, /Exportar Excel/);
    assert.match(src, /conic-gradient/);
    assert.match(src, /formatMontoMX/);
  });

  it("usa filtros asesor/fecha/buscar/etapa y paginación RPC", () => {
    assert.match(src, /listExpedientesPage/);
    assert.match(src, /getDashboard/);
    assert.match(src, /filtro_asesor|Todos los asesores/);
    assert.match(src, /fecha_desde/);
    assert.match(src, /Buscar/);
  });

  it("page.tsx ramifica a líder sin hardcode de email", () => {
    assert.match(page, /AsesorLiderDashboard/);
    assert.match(page, /isAsesorLiderDashboardMode|asesor_lider_get_context|getContext/);
    assert.doesNotMatch(page, /silvia\.reyes/i);
  });
});
