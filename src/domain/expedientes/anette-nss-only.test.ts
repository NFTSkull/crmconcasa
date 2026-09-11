import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isAnetteNssOnlyEmail,
  normalizeAnetteNssOnlyInput,
  parseAnetteNssOnlyPrepareResult,
  validateAnetteNssOnlyInput,
} from "./anette-nss-only";

describe("Anette NSS-only", () => {
  it("solo identifica el correo exacto de Anette", () => {
    assert.equal(isAnetteNssOnlyEmail("anette.perez@concasa.mx"), true);
    assert.equal(isAnetteNssOnlyEmail(" ANETTE.PEREZ@CONCASA.MX "), true);
    assert.equal(isAnetteNssOnlyEmail("silvia.reyes@concasa.mx"), false);
    assert.equal(isAnetteNssOnlyEmail("otro.externo@concasa.mx"), false);
    assert.equal(isAnetteNssOnlyEmail(null), false);
  });

  it("normaliza y valida únicamente NSS de 11 dígitos", () => {
    assert.equal(normalizeAnetteNssOnlyInput("12 345-678 901"), "12345678901");
    assert.equal(validateAnetteNssOnlyInput("12 345-678 901"), "12345678901");
    assert.throws(
      () => validateAnetteNssOnlyInput("1234567890"),
      /exactamente 11 dígitos/,
    );
  });

  it("parsea alta nueva y reprecalificación sin aceptar payload ambiguo", () => {
    const expedienteId = "11111111-1111-4111-8111-111111111111";
    const intentoId = "22222222-2222-4222-8222-222222222222";

    assert.deepEqual(
      parseAnetteNssOnlyPrepareResult({
        action: "created",
        expediente_id: expedienteId,
      }),
      { action: "created", expedienteId, intentoId: null },
    );
    assert.deepEqual(
      parseAnetteNssOnlyPrepareResult({
        action: "reprecal",
        expediente_id: expedienteId,
        intento_id: intentoId,
      }),
      { action: "reprecal", expedienteId, intentoId },
    );
    assert.equal(
      parseAnetteNssOnlyPrepareResult({
        action: "reprecal",
        expediente_id: expedienteId,
      }),
      null,
    );
  });
});
