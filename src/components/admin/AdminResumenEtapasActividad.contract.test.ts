import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("AdminResumenEtapasActividad contrato visual", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/admin/AdminResumenEtapasActividad.tsx"),
    "utf8",
  );

  it("unifica ingresos, movimientos y foto actual en una tabla por etapa", () => {
    assert.match(source, /Flujo de expedientes/);
    assert.match(source, /Pasaron en el periodo/);
    assert.match(source, /Siguen aquí/);
    assert.match(source, /Total actual/);
    assert.match(source, /ingresos del periodo/);
    assert.match(source, /expedientes con movimiento/);
    assert.match(source, /expedientes actuales/);
    assert.match(source, /<table/);
  });

  it("conserva los 11 pasos canónicos y alinea los ingresos al mismo paso visual", () => {
    assert.match(source, /ETAPAS_VISUALES_OPERATIVAS\.map/);
    assert.match(source, /mapEtapaInternaAPasoVisual\(bucket\.etapa\)/);
    assert.match(source, /cohortBuckets/);
    assert.match(source, /historyCompleteForPeriod/);
    assert.match(source, /historyCoverageFrom/);
  });
});
