import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bandaPropuestaMejoramiento,
  buildPropuestaMejoramiento,
  lineasPropuestaMejoramiento,
  PROPUESTA_BAND_90_130,
} from "./build-propuesta-mejoramiento.ts";

describe("buildPropuestaMejoramiento", () => {
  it("bandas determinísticas", () => {
    assert.equal(bandaPropuestaMejoramiento(50000), "hasta_50000");
    assert.equal(bandaPropuestaMejoramiento(50000.01), "50000_90000");
    assert.equal(bandaPropuestaMejoramiento(90000), "50000_90000");
    assert.equal(bandaPropuestaMejoramiento(90000.01), "90000_130000");
    assert.equal(bandaPropuestaMejoramiento(102529.36), "90000_130000");
    assert.equal(bandaPropuestaMejoramiento(130000), "90000_130000");
    assert.equal(bandaPropuestaMejoramiento(130000.01), "130000_169000");
  });

  it("102529.36 → 4 conceptos banda 90k–130k", () => {
    const lines = lineasPropuestaMejoramiento(102529.36);
    assert.equal(lines.length, 4);
    assert.deepEqual(lines, [...PROPUESTA_BAND_90_130]);
    for (const line of lines) {
      assert.ok(line.length <= 60, `"${line}" excede 60 (${line.length})`);
    }
    const text = buildPropuestaMejoramiento(102529.36);
    assert.equal(text, PROPUESTA_BAND_90_130.join("\n"));
    assert.equal(text.split("\n").length, 4);
  });

  it("hasta 50k → 3 conceptos", () => {
    assert.equal(lineasPropuestaMejoramiento(49999).length, 3);
  });

  it("50k–90k → 3 conceptos", () => {
    assert.equal(lineasPropuestaMejoramiento(75000).length, 3);
  });

  it("130k–169k → 4 conceptos mayor alcance", () => {
    assert.equal(lineasPropuestaMejoramiento(150000).length, 4);
    assert.match(buildPropuestaMejoramiento(150000), /mayor alcance/i);
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
