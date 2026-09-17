import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("AdminResumenEtapasActividad contrato visual", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/admin/AdminResumenEtapasActividad.tsx"),
    "utf8",
  );

  it("prioriza dónde están hoy los ingresos del periodo", () => {
    assert.match(source, /Distribución actual de los ingresos del periodo/);
    assert.match(source, /de \$\{cohortTotalDisplay\} ingresos/);
    assert.match(source, /CRM hoy:/);
    assert.match(source, /style=\{\{ width:/);
  });

  it("explica la etapa seleccionada con tres métricas distintas", () => {
    assert.match(source, /Ingresos del periodo que siguen aquí/);
    assert.match(source, /Llegaron a esta etapa en el periodo/);
    assert.match(source, /Total actualmente en esta etapa/);
    assert.match(source, /Los tres números no se suman entre sí/);
  });

  it("deja movimientos como detalle secundario desplegable", () => {
    assert.match(source, /<details/);
    assert.match(source, /Ver movimientos del periodo por etapa/);
    assert.match(source, /Llegaron a esta etapa/);
    assert.match(source, /Ingresaron a Mesa en el periodo/);
    assert.match(source, /Ya venían de antes/);
  });

  it("usa una sola numeración visible de 10 etapas Admin", () => {
    assert.match(source, /ADMIN_VISIBLE_STAGES\.map/);
    assert.match(source, /TOTAL_PASOS_ADMIN_VISIBLES/);
    assert.match(source, /mapEtapaInternaAAdminPaso\(bucket\.etapa\)/);
    assert.match(source, /by_paso_admin/);
    assert.doesNotMatch(source, /ETAPAS_VISUALES_OPERATIVAS\.map/);
    assert.doesNotMatch(source, /Paso 11/);
  });

  it("conserva cobertura histórica y fuentes read-only", () => {
    assert.match(source, /historyCompleteForPeriod/);
    assert.match(source, /historyCoverageFrom/);
    assert.match(source, /admin_resumen_movimientos_etapas/);
  });
});
