import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ASESOR_EXTERNO_NSS_ONLY_DEFAULT_PROGRAMA,
  ASESOR_EXTERNO_NSS_ONLY_PENDING_NAME,
  ASESOR_EXTERNO_NSS_ONLY_PENDING_PHONE,
  buildExternalNssOnlyCreateInput,
  isAsesorExternoOrigin,
  resolveExternalExistingPrograma,
  validateExternalNssOnly,
} from "./asesor-externo-nss-only";

describe("asesor externo NSS-only", () => {
  it("detecta origen externo sin depender de mayúsculas/espacios", () => {
    assert.equal(isAsesorExternoOrigin(" externo "), true);
    assert.equal(isAsesorExternoOrigin("EXTERNO"), true);
    assert.equal(isAsesorExternoOrigin("interno"), false);
    assert.equal(isAsesorExternoOrigin(null), false);
  });

  it("acepta únicamente NSS de 11 dígitos y normaliza separadores", () => {
    assert.equal(validateExternalNssOnly("12345678901"), "12345678901");
    assert.equal(validateExternalNssOnly("123-45-678901"), "12345678901");
    assert.throws(
      () => validateExternalNssOnly("1234567890"),
      /exactamente 11 dígitos/,
    );
  });

  it("construye alta técnica sin pedir nombre/teléfono/programa al usuario", () => {
    const input = buildExternalNssOnlyCreateInput({
      nss: "12345678901",
      asesorEmail: "externo@concasa.mx",
    });

    assert.equal(input.programa, ASESOR_EXTERNO_NSS_ONLY_DEFAULT_PROGRAMA);
    assert.equal(input.programa, "Mejoravit");
    assert.equal(input.cliente_nombre, ASESOR_EXTERNO_NSS_ONLY_PENDING_NAME);
    assert.equal(input.telefono_cliente, ASESOR_EXTERNO_NSS_ONLY_PENDING_PHONE);
    assert.equal(input.direccion_opcional, "");
  });

  it("reprecal NSS-only conserva el programa existente", () => {
    assert.equal(
      resolveExternalExistingPrograma({
        status: "reprecal_change_programa",
        message: "x",
        programa_actual: "subcuenta",
      }),
      "Subcuenta",
    );
    assert.equal(
      resolveExternalExistingPrograma({
        status: "reprecal_change_programa",
        message: "x",
        programa_actual: "compro_tu_casa",
      }),
      "Compro tu casa",
    );
    assert.equal(
      resolveExternalExistingPrograma({
        status: "reprecal_own_mesa",
        message: "x",
        programa_actual: "mejoravit",
      }),
      "Mejoravit",
    );
  });
});
