import assert from "node:assert/strict";
import test from "node:test";
import {
  calcMontoCalculadoCobro,
  parseMontoCalculadoInput,
  parsePorcentajeCobroInput,
} from "./clienteDatosCobro";

test("parsePorcentajeCobroInput acepta decimales", () => {
  assert.equal(parsePorcentajeCobroInput("12.5"), 12.5);
  assert.equal(parsePorcentajeCobroInput("10"), 10);
});

test("parseMontoCalculadoInput acepta montos", () => {
  assert.equal(parseMontoCalculadoInput("2500"), 2500);
  assert.equal(parseMontoCalculadoInput("$2,500.50"), 2500.5);
  assert.equal(parseMontoCalculadoInput(""), null);
});

test("calcMontoCalculadoCobro deriva monto con base fija", () => {
  assert.equal(calcMontoCalculadoCobro(100000, 10), 13000);
  assert.equal(calcMontoCalculadoCobro(25000, 12.5), 6125);
  assert.equal(calcMontoCalculadoCobro(166100.12, 10), 19610.01);
});

test("calcMontoCalculadoCobro sin monto aprobado devuelve null", () => {
  assert.equal(calcMontoCalculadoCobro(null, 10), null);
  assert.equal(calcMontoCalculadoCobro(0, 10), null);
});
