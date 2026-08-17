import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSaveClienteDatosCorreccionRpcError } from "./save-cliente-datos-correccion-rpc-error";
import { ClienteDatosSupabaseError } from "./supabase.error";

describe("mapSaveClienteDatosCorreccionRpcError", () => {
  it("mapea rol no autorizado", () => {
    const err = mapSaveClienteDatosCorreccionRpcError({
      message: "save_cliente_datos_correccion: rol no autorizado (mesa_admin)",
    });
    assert.ok(err instanceof ClienteDatosSupabaseError);
    assert.match(err.message, /asesor dueño/i);
  });

  it("mapea datos no rechazados", () => {
    const err = mapSaveClienteDatosCorreccionRpcError({
      message: "solo se pueden corregir datos con estado rechazado",
    });
    assert.match(err.message, /rechazado/i);
  });

  it("mapea expediente no enviado a Mesa", () => {
    const err = mapSaveClienteDatosCorreccionRpcError({
      message: "el expediente no fue enviado a Mesa",
    });
    assert.match(err.message, /enviar el expediente a Mesa/i);
  });

  it("mapea CLIENTE_DATOS_TELEFONO_DUPLICADO sin PII", () => {
    const err = mapSaveClienteDatosCorreccionRpcError({
      message: "save_cliente_datos: CLIENTE_DATOS_TELEFONO_DUPLICADO",
    });
    assert.match(err.message, /No se pueden repetir números telefónicos/i);
    assert.doesNotMatch(err.message, /\d{10}/);
    assert.doesNotMatch(err.message, /CLIENTE_DATOS_TELEFONO_DUPLICADO/);
  });

  it("mapea RFC inválido", () => {
    const err = mapSaveClienteDatosCorreccionRpcError({
      message: "save_cliente_datos: RFC inválido",
    });
    assert.match(err.message, /RFC/i);
  });

  it("mapea RPC no desplegada", () => {
    const err = mapSaveClienteDatosCorreccionRpcError({
      message: "could not find the function save_cliente_datos_correccion",
    });
    assert.match(err.message, /aún no está disponible/i);
  });
});
