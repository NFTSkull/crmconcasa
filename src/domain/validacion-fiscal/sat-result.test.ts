import test from "node:test";
import assert from "node:assert/strict";
import { classifySatRfcText, classifySatCurpText } from "./sat-result";

test("RFC SAT positivo solo con evidencia explícita", () => {
  assert.equal(classifySatRfcText("RFC válido, y susceptible de recibir facturas"), "valid");
});

test("CURP SAT positiva solo con evidencia explícita", () => {
  assert.equal(classifySatCurpText("Estatus: Registrado en el padrón de contribuyentes."), "valid");
});

test("captcha/error/HTML inesperado nunca se interpreta como inválido", () => {
  assert.equal(classifySatRfcText("Captcha incorrecto. Intente nuevamente."), "unknown");
  assert.equal(classifySatCurpText("Error interno del servidor"), "unknown");
  assert.equal(classifySatRfcText(""), "unknown");
});

test("un negativo solo se activa con patrón certificado", () => {
  assert.equal(
    classifySatRfcText("RFC NO REGISTRADO EN EL PADRON", [/RFC NO REGISTRADO EN EL PADRON/]),
    "invalid",
  );
});
