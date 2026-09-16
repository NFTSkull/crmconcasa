import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("AdminResumenEtapasActividad contrato visual", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/admin/AdminResumenEtapasActividad.tsx"),
    "utf8",
  );

  it("explica claramente los cuatro números por etapa", () => {
    assert.match(source, /Llegaron en periodo/);
    assert.match(source, />Ahora</);
    assert.match(source, /De antes/);
    assert.match(source, /Ingresaron en rango/);
  });

  it("mantiene los 11 pasos canónicos y avisa cobertura incompleta", () => {
    assert.match(source, /ETAPAS_VISUALES_OPERATIVAS\.map/);
    assert.match(source, /historyCompleteForPeriod/);
    assert.match(source, /historyCoverageFrom/);
  });
});
