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

  it("mapea documentos obligatorios faltantes con contador dinámico (3 de 8)", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: faltan documentos obligatorios validados (3 de 8)",
    });
    assert.match(err.message, /3 de 8/);
    assert.ok(!err.message.includes("7 documentos requeridos"));
    assert.ok(!err.message.includes("8 documentos requeridos"));
  });

  it("mapea documentos obligatorios faltantes con contador (4 de 4)", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: faltan documentos obligatorios validados (4 de 4)",
    });
    assert.match(err.message, /4 de 4/);
    assert.ok(!err.message.includes("7 documentos requeridos"));
  });

  it("mapea documentos obligatorios sin contador → genérico sin número hardcodeado", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: faltan documentos obligatorios validados",
    });
    assert.match(err.message, /documentos obligatorios validados/i);
    assert.match(err.message, /documentos requeridos/i);
    assert.ok(!/\d/.test(err.message));
    assert.ok(!err.message.includes("7 documentos requeridos"));
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

  it("mapea falta fecha de cita de firma", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: falta fecha de cita de firma",
    });
    assert.match(err.message, /fecha de cita de firma/i);
  });

  it("mapea falta booking de firma activo", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "avanzar_etapa_operativa: falta booking de firma activo",
    });
    assert.match(err.message, /reserva de firma activa/i);
  });

  it("mapea error inesperado", () => {
    const err = mapAvanzarEtapaRpcError({
      message: "algo totalmente desconocido",
    });
    assert.match(err.message, /no se pudo avanzar la etapa/i);
  });
});
