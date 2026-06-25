import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapRegisterExpedienteDocumentoCorreccionRpcError } from "./register-expediente-documento-correccion-rpc-error";
import { ExpedienteArchivosSupabaseError } from "./supabase.error";

describe("mapRegisterExpedienteDocumentoCorreccionRpcError", () => {
  it("mapea rol no autorizado", () => {
    const err = mapRegisterExpedienteDocumentoCorreccionRpcError({
      message: "register_expediente_documento_correccion: rol no autorizado (mesa_admin)",
    });
    assert.ok(err instanceof ExpedienteArchivosSupabaseError);
    assert.match(err.message, /asesor dueño/i);
  });

  it("mapea documento no rechazado", () => {
    const err = mapRegisterExpedienteDocumentoCorreccionRpcError({
      message: "solo se puede corregir un documento rechazado por Mesa",
    });
    assert.match(err.message, /rechazados por Mesa/i);
  });

  it("mapea tipo no permitido", () => {
    const err = mapRegisterExpedienteDocumentoCorreccionRpcError({
      message: "tipo_documento no permitido (cliente_acta_nacimiento)",
    });
    assert.match(err.message, /no puede corregirlo el asesor/i);
  });

  it("mapea storage faltante", () => {
    const err = mapRegisterExpedienteDocumentoCorreccionRpcError({
      message: "objeto no encontrado en storage",
    });
    assert.match(err.message, /almacenamiento/i);
  });

  it("mapea RPC no desplegada", () => {
    const err = mapRegisterExpedienteDocumentoCorreccionRpcError({
      message: "could not find the function register_expediente_documento_correccion",
    });
    assert.match(err.message, /aún no está disponible/i);
  });
});
