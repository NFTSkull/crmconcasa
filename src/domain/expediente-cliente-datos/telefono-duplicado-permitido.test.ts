import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTelefonoMexico } from "@/lib/clienteDatosValidation";
import { mapEnviarAMesaRpcError } from "@/domain/expedientes/enviar-mesa-rpc-error";
import { mapSaveClienteDatosRpcError } from "./save-cliente-datos-rpc-error";

/**
 * P098 — El teléfono no es identidad del expediente.
 * Identidad canónica: expediente_id (y reglas NSS vigentes aparte).
 */
describe("P098 teléfonos repetidos entre expedientes", () => {
  it("normaliza +52, espacios y guiones al mismo valor de 10 dígitos", () => {
    const canonical = "5520202020";
    assert.equal(normalizeTelefonoMexico(canonical), canonical);
    assert.equal(normalizeTelefonoMexico("+52 55 2020 2020"), canonical);
    assert.equal(normalizeTelefonoMexico("55-2020-2020"), canonical);
    assert.equal(normalizeTelefonoMexico("(55) 2020-2020"), canonical);
    assert.equal(normalizeTelefonoMexico("  5520202020  "), canonical);
  });

  it("mapea repetición intra-payload (cliente vs referencias), no confunde con cross-expediente", () => {
    const err = mapSaveClienteDatosRpcError({
      message: "save_cliente_datos: teléfono repetido en referencias",
    });
    assert.match(err.message, /no puede repetirse en las referencias/i);
    assert.doesNotMatch(err.message, /otro expediente/i);
  });

  it("mapea repetición entre referencias del mismo payload", () => {
    const err = mapSaveClienteDatosRpcError({
      message: "save_cliente_datos: teléfono de referencia repetido",
    });
    assert.match(err.message, /entre las referencias/i);
  });

  it("mensaje legacy cross-expediente (solo Cloud sin migración 093)", () => {
    const err = mapSaveClienteDatosRpcError({
      message: "save_cliente_datos: teléfono repetido",
    });
    assert.match(err.message, /ya está registrado/i);
  });

  it("NSS duplicado enviado a Mesa conserva su mapeo (regla intacta)", () => {
    const err = mapEnviarAMesaRpcError({
      message: "enviar_a_mesa: nss_ya_bloqueado",
    });
    assert.match(err.message, /Este NSS ya tiene un expediente enviado a Mesa/i);
  });
});
