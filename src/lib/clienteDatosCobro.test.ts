import assert from "node:assert/strict";
import test from "node:test";
import {
  calcMontoCalculadoCobro,
  parsePorcentajeCobroInput,
} from "./clienteDatosCobro";

test("parsePorcentajeCobroInput acepta decimales", () => {
  assert.equal(parsePorcentajeCobroInput("12.5"), 12.5);
  assert.equal(parsePorcentajeCobroInput("10"), 10);
});

test("calcMontoCalculadoCobro deriva monto", () => {
  assert.equal(calcMontoCalculadoCobro(100000, 10), 10000);
  assert.equal(calcMontoCalculadoCobro(25000, 12.5), 3125);
});

test("calcMontoCalculadoCobro sin monto aprobado devuelve null", () => {
  assert.equal(calcMontoCalculadoCobro(null, 10), null);
  assert.equal(calcMontoCalculadoCobro(0, 10), null);
});
