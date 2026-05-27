import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  etapaActualParaOperativo,
  etapaAlEnviarAMesaDesdeAsesor,
} from "./mock.repo";

describe("B0D4: etapa al enviar a Mesa (Integración)", () => {
  it("etapaAlEnviarAMesaDesdeAsesor no incrementa de 1 a 2", () => {
    assert.equal(etapaAlEnviarAMesaDesdeAsesor(1), 1);
    assert.equal(etapaAlEnviarAMesaDesdeAsesor(null), 1);
    assert.equal(etapaAlEnviarAMesaDesdeAsesor(undefined), 1);
  });

  it("etapaAlEnviarAMesaDesdeAsesor no retrocede si ya está en etapa 2 o superior", () => {
    assert.equal(etapaAlEnviarAMesaDesdeAsesor(2), 2);
    assert.equal(etapaAlEnviarAMesaDesdeAsesor(8), 8);
  });

  it("en_validacion_mesa mantiene etapa 1 en lectura operativa (dashboard/listados)", () => {
    assert.equal(etapaActualParaOperativo(1, "en_validacion_mesa"), 1);
    assert.equal(etapaActualParaOperativo(null, "en_validacion_mesa"), 1);
  });

  it("en_validacion_mesa no fuerza 2 cuando inbox tenía etapa 1", () => {
    assert.notEqual(etapaActualParaOperativo(1, "en_validacion_mesa"), 2);
  });

  it("Mesa puede reflejar etapa 2 tras aprobación (subestado distinto)", () => {
    assert.equal(etapaActualParaOperativo(2, "en_proceso"), 2);
    assert.equal(etapaActualParaOperativo(2, "aprobado"), 2);
  });

  it("en_validacion_mesa no retrocede expediente ya en etapa >= 2", () => {
    assert.equal(etapaActualParaOperativo(3, "en_validacion_mesa"), 3);
    assert.equal(etapaActualParaOperativo(2, "en_validacion_mesa"), 2);
  });
});
