import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MESA_RECHAZO_OPERATIVO_MOTIVOS,
  isRechazoOperativoMotivoOtro,
  motivoRechazoOperativoEsValido,
  resolveMotivoRechazoOperativo,
} from "./mesa-rechazo-operativo-motivos";
import { buildRechazoOperativoPayload } from "./mesa-rechazo-operativo-payload";

describe("P099 motivos rechazo operativo", () => {
  it("incluye opción Otro en el catálogo", () => {
    assert.ok(MESA_RECHAZO_OPERATIVO_MOTIVOS.includes("Otro"));
  });

  it("motivo obligatorio: vacío o Otro sin texto no son válidos", () => {
    assert.equal(motivoRechazoOperativoEsValido("", ""), false);
    assert.equal(motivoRechazoOperativoEsValido("Otro", ""), false);
    assert.equal(motivoRechazoOperativoEsValido("Otro", "   "), false);
  });

  it("opción Otro usa el texto libre como motivo", () => {
    assert.equal(isRechazoOperativoMotivoOtro("Otro"), true);
    assert.equal(
      resolveMotivoRechazoOperativo("Otro", "Cliente no reúne requisitos"),
      "Cliente no reúne requisitos",
    );
  });

  it("motivo de catálogo es válido sin texto Otro", () => {
    assert.equal(motivoRechazoOperativoEsValido("Huellas ilegibles", ""), true);
    assert.equal(
      resolveMotivoRechazoOperativo("Huellas ilegibles", "ignorado"),
      "Huellas ilegibles",
    );
  });
});

describe("P099 payload rechazo operativo", () => {
  it("envía defaults biométricos seguros y nota opcional null", () => {
    const payload = buildRechazoOperativoPayload({
      motivo: "Huellas ilegibles",
      comentario: "  ",
    });
    assert.equal(payload.motivo, "Huellas ilegibles");
    assert.equal(payload.comentario, null);
    assert.equal(payload.biometricosCondicion, "desconocida");
    assert.equal(payload.biometricosRazon, null);
    assert.equal(payload.biometricosBookingId, null);
  });

  it("conserva nota opcional cuando hay texto", () => {
    const payload = buildRechazoOperativoPayload({
      motivo: "Mal buró",
      comentario: " Revisar buró ",
    });
    assert.equal(payload.comentario, "Revisar buró");
  });
});
