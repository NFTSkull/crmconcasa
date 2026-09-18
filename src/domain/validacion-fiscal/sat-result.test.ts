import test from "node:test";
import assert from "node:assert/strict";
import { classifySatRfcText, classifySatCurpText } from "./sat-result";

test("RFC SAT positivo solo con evidencia explícita", () => {
  assert.equal(classifySatRfcText("RFC válido, y susceptible de recibir facturas"), "valid");
});

test("CURP SAT positiva solo con evidencia explícita", () => {
  assert.equal(classifySatCurpText("Estatus: Registrado en el padrón de contribuyentes."), "valid");
});

test("RFC SAT negativo certificado se clasifica invalid", () => {
  assert.equal(
    classifySatRfcText("Estatus: RFC no registrado en el padrón de contribuyentes"),
    "invalid",
  );
  assert.equal(
    classifySatRfcText("RFC válido no susceptible de recibir facturas"),
    "invalid",
  );
  assert.equal(classifySatRfcText("Estructura del RFC incorrecta"), "invalid");
});

test("CURP no registrada nunca se confunde con registrada", () => {
  assert.equal(
    classifySatCurpText("Estatus: No registrado en el padrón de contribuyentes."),
    "invalid",
  );
});

test("captcha/error/HTML inesperado nunca se interpreta como inválido", () => {
  assert.equal(classifySatRfcText("Captcha incorrecto. Intente nuevamente."), "unknown");
  assert.equal(classifySatCurpText("Error interno del servidor"), "unknown");
  assert.equal(classifySatRfcText(""), "unknown");
});

test("patrones certificados adicionales siguen soportados explícitamente", () => {
  assert.equal(
    classifySatRfcText("RFC BLOQUEADO POR FUENTE CERTIFICADA", [/RFC BLOQUEADO POR FUENTE CERTIFICADA/]),
    "invalid",
  );
});
