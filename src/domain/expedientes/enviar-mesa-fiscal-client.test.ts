import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapEnviarMesaFiscalHttpError } from "./enviar-mesa-fiscal-client";

describe("mapEnviarMesaFiscalHttpError", () => {
  it("RFC inválido deja claro que no se envió a Mesa", () => {
    assert.match(
      mapEnviarMesaFiscalHttpError({ code: "RFC_INVALIDO_SAT" }).message,
      /RFC.*SAT.*no se envió a Mesa/i,
    );
  });

  it("CURP inválida deja claro que no se envió a Mesa", () => {
    assert.match(
      mapEnviarMesaFiscalHttpError({ code: "CURP_INVALIDA_SAT" }).message,
      /CURP.*no se envió a Mesa/i,
    );
  });

  it("fallo técnico SAT queda retry sin afirmar invalidez", () => {
    const message = mapEnviarMesaFiscalHttpError({
      code: "TECHNICAL_FAILURE",
      status: "retry",
    }).message;
    assert.match(message, /No se pudo completar la validación con SAT/i);
    assert.doesNotMatch(message, /inválid/i);
  });

  it("RFC no resuelto nunca autoriza ni acusa invalidez", () => {
    const message = mapEnviarMesaFiscalHttpError({
      code: "RFC_NO_RESUELTO_AMBIGUOUS_CANDIDATES",
      status: "retry",
    }).message;
    assert.match(message, /determinar con seguridad/i);
    assert.doesNotMatch(message, /inválid/i);
  });

  it("si cambian los insumos durante SAT obliga a revalidar", () => {
    const message = mapEnviarMesaFiscalHttpError({
      code: "FISCAL_INPUT_CHANGED",
      status: "retry",
    }).message;
    assert.match(message, /cambiaron durante la validación/i);
    assert.match(message, /No se envió a Mesa/i);
  });

  it("tras PASS fiscal conserva mapper de la RPC existente", () => {
    const error = mapEnviarMesaFiscalHttpError({
      status: "send_failed_after_fiscal_pass",
      code: "22023",
      message: "faltan documentos obligatorios de integración (3 de 4)",
    });
    assert.match(error.message, /tienes 3 de 4/i);
  });
});
