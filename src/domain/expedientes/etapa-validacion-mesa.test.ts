import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { etapaActualParaOperativo } from "./mock.repo";

describe("etapaActualParaOperativo", () => {
  it("en_validacion_mesa mantiene Integración (1), no salta a Registro (2)", () => {
    assert.equal(etapaActualParaOperativo(null, "en_validacion_mesa"), 1);
    assert.equal(etapaActualParaOperativo(1, "en_validacion_mesa"), 1);
  });

  it("no altera etapa cuando no está en validación mesa", () => {
    assert.equal(etapaActualParaOperativo(3, "en_proceso"), 3);
    assert.equal(etapaActualParaOperativo(null, "pendiente"), null);
    assert.equal(etapaActualParaOperativo(null, "en_proceso"), null);
  });

  it("en_validacion_mesa no retrocede si inbox ya tenía etapa >= 2", () => {
    assert.equal(etapaActualParaOperativo(2, "en_validacion_mesa"), 2);
    assert.equal(etapaActualParaOperativo(5, "en_validacion_mesa"), 5);
  });
});
