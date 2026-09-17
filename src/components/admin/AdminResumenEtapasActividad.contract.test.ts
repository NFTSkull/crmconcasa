import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("AdminResumenEtapasActividad contrato visual", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/admin/AdminResumenEtapasActividad.tsx"),
    "utf8",
  );

  it("unifica cohorte, movimientos y foto actual en una sola lectura por etapa", () => {
    assert.match(source, /Flujo de expedientes/);
    assert.match(source, /Pasaron aquí/);
    assert.match(source, /Siguen aquí/);
    assert.match(source, /Total hoy/);
    assert.match(source, /Ingresaron a Mesa/);
    assert.match(source, /Tuvieron movimiento/);
    assert.match(source, /Expedientes hoy/);
  });

  it("conserva los 11 pasos canónicos y alinea la cohorte interna al mismo paso visual", () => {
    assert.match(source, /ETAPAS_VISUALES_OPERATIVAS\.map/);
    assert.match(source, /mapEtapaInternaAPasoVisual\(bucket\.etapa\)/);
    assert.match(source, /cohortBuckets/);
    assert.match(source, /historyCompleteForPeriod/);
    assert.match(source, /historyCoverageFrom/);
  });
});
