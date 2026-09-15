import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandaPropuestaMejoramiento,
  buildPropuestaMejoramiento,
  lineasPropuestaMejoramiento,
  PROPUESTA_MAYOR_100K,
} from "./build-propuesta-mejoramiento.ts";

describe("buildPropuestaMejoramiento v5", () => {
  it("respeta el corte exacto de 100k", () => {
    assert.equal(bandaPropuestaMejoramiento(40000), "hasta_40000");
    assert.equal(bandaPropuestaMejoramiento(40000.01), "40000_100000");
    assert.equal(bandaPropuestaMejoramiento(100000), "40000_100000");
    assert.equal(bandaPropuestaMejoramiento(100000.01), "mayor_100000");
  });

  it("arriba de 100k usa una sola línea de paneles solares", () => {
    assert.deepEqual(lineasPropuestaMejoramiento(102529.36, "exp-1|v2"), [
      PROPUESTA_MAYOR_100K,
    ]);
    assert.equal(
      buildPropuestaMejoramiento(102529.36, "exp-1|v2"),
      "Instalación de paneles solares.",
    );
  });

  it("hasta 100k devuelve exactamente una mejora corta sin saltos", () => {
    for (const monto of [25000, 40000, 40000.01, 75000, 100000]) {
      const text = buildPropuestaMejoramiento(monto, `exp-${monto}|v1`);
      assert.ok(text.length > 0);
      assert.ok(text.length <= 48, `Texto demasiado largo: ${text}`);
      assert.equal(text.includes("\n"), false);
      assert.equal(lineasPropuestaMejoramiento(monto, `exp-${monto}|v1`).length, 1);
    }
  });

  it("la misma seed produce exactamente la misma frase para Carta y Presupuesto", () => {
    const carta = buildPropuestaMejoramiento(82000, "cliente-abc|v3");
    const presupuesto = buildPropuestaMejoramiento(82000, "cliente-abc|v3");
    assert.equal(carta, presupuesto);
  });

  it("seeds distintas permiten variar la mejora hasta 100k", () => {
    const textos = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) =>
        buildPropuestaMejoramiento(82000, seed),
      ),
    );
    assert.ok(textos.size > 1);
  });

  it("monto inválido devuelve vacío", () => {
    assert.equal(buildPropuestaMejoramiento(null), "");
    assert.equal(buildPropuestaMejoramiento(0), "");
    assert.equal(buildPropuestaMejoramiento(-1), "");
  });
});
