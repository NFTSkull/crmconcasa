import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapAvanzarEtapaRpcError } from "./avanzar-etapa-rpc-error";
import { ExpedientesSupabaseError } from "./supabase.error";

describe("mapAvanzarEtapaRpcError", () => {
  it("mapea datos cliente no validados", () => {
    const err = mapAvanzarEtapaRpcError({
      message:
        "avanzar_etapa_operativa: datos del cliente deben estar validados por Mesa (actual: completo)",
    });
    assert.ok(err instanceof ExpedientesSupabaseError);
    assert.match(err.message, /datos generales deben estar validados/i);
  });

  it("mapea documentos obligatorios faltantes", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: faltan documentos obligatorios validados (5 de 7)",
    });
    assert.match(err.message, /documentos obligatorios validados/i);
  });

  it("mapea subestado incorrecto", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: subestado debe ser en_validacion_mesa (actual: en_proceso)",
    });
    assert.match(err.message, /validación por Mesa/i);
  });

  it("mapea no autorizado por código 42501", () => {
    const err = mapAvanzarEtapaRpcError({
      code: "42501",
      message: "permission denied",
    });
    assert.match(err.message, /permiso/i);
  });

  it("mapea error inesperado", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "algo totalmente desconocido",
    });
    assert.match(err.message, /no se pudo avanzar la etapa/i);
  });
});
