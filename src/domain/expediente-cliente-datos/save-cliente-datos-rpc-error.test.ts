import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSaveClienteDatosRpcError } from "./save-cliente-datos-rpc-error";
import { ClienteDatosSupabaseError } from "./supabase.error";

describe("mapSaveClienteDatosRpcError", () => {
  it("mapea RFC obligatorio", () => {
    const err = mapSaveClienteDatosRpcError({
      message: "save_cliente_datos: RFC obligatorio",
    });
    assert.ok(err instanceof ClienteDatosSupabaseError);
    assert.match(err.message, /RFC es obligatorio/i);
  });

  it("mapea teléfono inválido", () => {
    const err = mapSaveClienteDatosRpcError({
      message: "save_cliente_datos: teléfono inválido",
    });
    assert.match(err.message, /10 dígitos/i);
  });

  it("mapea expediente ya enviado a mesa", () => {
    const err = mapSaveClienteDatosRpcError({
      message: "save_cliente_datos: expediente ya enviado a Mesa",
    });
    assert.match(err.message, /después de enviar a Mesa/i);
  });

  it("mapea teléfono repetido (legacy cross-expediente; Cloud sin 093)", () => {
    const err = mapSaveClienteDatosRpcError({
      message: "save_cliente_datos: teléfono repetido",
    });
    assert.match(err.message, /ya está registrado/i);
  });

  it("mapea teléfono repetido en referencias sin confundirlo con cross-expediente", () => {
    const err = mapSaveClienteDatosRpcError({
      message: "save_cliente_datos: teléfono repetido en referencias",
    });
    assert.match(err.message, /no puede repetirse en las referencias/i);
    assert.doesNotMatch(err.message, /otro expediente/i);
  });

  it("mapea error inesperado", () => {
    const err = mapSaveClienteDatosRpcError({ message: "algo raro" });
    assert.match(err.message, /no se pudieron guardar/i);
  });
});
