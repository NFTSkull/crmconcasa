import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandaPropuestaMejoramiento,
  buildPropuestaMejoramiento,
  lineasPropuestaMejoramiento,
  PROPUESTA_30000_60000,
  PROPUESTA_60000_80000,
  PROPUESTA_80000_100000,
  PROPUESTA_HASTA_30000,
  PROPUESTA_MAS_100000,
} from "./build-propuesta-mejoramiento.ts";

describe("buildPropuestaMejoramiento", () => {
  it("bandas determinísticas", () => {
    assert.equal(bandaPropuestaMejoramiento(30000), "hasta_30000");
    assert.equal(bandaPropuestaMejoramiento(30000.01), "30000_60000");
    assert.equal(bandaPropuestaMejoramiento(60000), "30000_60000");
    assert.equal(bandaPropuestaMejoramiento(60000.01), "60000_80000");
    assert.equal(bandaPropuestaMejoramiento(80000), "60000_80000");
    assert.equal(bandaPropuestaMejoramiento(80000.01), "80000_100000");
    assert.equal(bandaPropuestaMejoramiento(100000), "80000_100000");
    assert.equal(bandaPropuestaMejoramiento(100000.01), "mas_100000");
  });

  it("siempre devuelve un solo concepto corto", () => {
    for (const monto of [25000, 45000, 70000, 95000, 120000, 169000]) {
      const lines = lineasPropuestaMejoramiento(monto);
      assert.equal(lines.length, 1, String(monto));
      assert.ok(lines[0]!.length <= 60, `"${lines[0]}" excede 60`);
      assert.equal(buildPropuestaMejoramiento(monto), lines[0]);
      assert.equal(buildPropuestaMejoramiento(monto).split("\n").length, 1);
    }
  });

  it("mapea categorías razonables por monto", () => {
    assert.equal(buildPropuestaMejoramiento(30000), PROPUESTA_HASTA_30000);
    assert.equal(buildPropuestaMejoramiento(45000), PROPUESTA_30000_60000);
    assert.equal(buildPropuestaMejoramiento(70000), PROPUESTA_60000_80000);
    assert.equal(buildPropuestaMejoramiento(95000), PROPUESTA_80000_100000);
  });

  it("arriba de 100k usa exactamente Instalación de paneles solares", () => {
    assert.equal(PROPUESTA_MAS_100000, "Instalación de paneles solares");
    for (const monto of [100000.01, 102529.36, 138132, 169000, 250000]) {
      assert.equal(buildPropuestaMejoramiento(monto), "Instalación de paneles solares");
      assert.equal(buildPropuestaMejoramiento(monto).split("\n").length, 1);
    }
  });

  it("monto inválido → vacío", () => {
    assert.equal(buildPropuestaMejoramiento(null), "");
    assert.equal(buildPropuestaMejoramiento(0), "");
    assert.equal(buildPropuestaMejoramiento(-1), "");
  });

  it("es determinístico", () => {
    assert.equal(
      buildPropuestaMejoramiento(102529.36),
      buildPropuestaMejoramiento(102529.36),
    );
  });
});
