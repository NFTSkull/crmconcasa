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
    assert.match(source, /¿Dónde están hoy los expedientes que ingresaron en el periodo\?/);
    assert.match(source, /Distribución actual de los ingresos del periodo/);
    assert.match(source, /de los ingresos siguen aquí/);
    assert.match(source, /CRM hoy:/);
    assert.match(source, /style=\{\{ width:/);
  });

  it("deja la actividad histórica como detalle secundario desplegable", () => {
    assert.match(source, /<details/);
    assert.match(source, /Ver actividad del periodo por etapa/);
    assert.match(source, /Pasaron por aquí/);
    assert.match(source, /Ingresaron en el periodo/);
    assert.match(source, /Venían de antes/);
  });

  it("conserva los 11 pasos canónicos y alinea los ingresos al mismo paso visual", () => {
    assert.match(source, /ETAPAS_VISUALES_OPERATIVAS\.map/);
    assert.match(source, /mapEtapaInternaAPasoVisual\(bucket\.etapa\)/);
    assert.match(source, /cohortBuckets/);
    assert.match(source, /historyCompleteForPeriod/);
    assert.match(source, /historyCoverageFrom/);
  });
});
