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

  it("mapea subestado debe ser en_proceso", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: subestado debe ser en_proceso (actual: en_validacion_mesa)",
    });
    assert.match(err.message, /subestado en proceso/i);
  });

  it("mapea no autorizado por código 42501", () => {
    const err = mapAvanzarEtapaRpcError({
      code: "42501",
      message: "permission denied",
    });
    assert.match(err.message, /permiso/i);
  });

  it("mapea falta fecha de cita biométrica", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: falta fecha de cita biométrica",
    });
    assert.match(err.message, /fecha de cita biométrica/i);
  });

  it("mapea falta booking biométrico activo", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: falta booking biométrico activo",
    });
    assert.match(err.message, /reserva biométrica activa/i);
  });

  it("mapea cita biométrica aún no ha ocurrido", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: cita biométrica aún no ha ocurrido",
    });
    assert.match(err.message, /aún no ha ocurrido/i);
    assert.match(err.message, /inscripción/i);
  });

  it("mapea error inesperado", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "algo totalmente desconocido",
    });
    assert.match(err.message, /no se pudo avanzar la etapa/i);
  });
});
