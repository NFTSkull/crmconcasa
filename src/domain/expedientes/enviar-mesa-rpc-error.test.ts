import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapEnviarAMesaRpcError } from "./enviar-mesa-rpc-error";
import { ExpedientesSupabaseError } from "./supabase.error";

describe("mapEnviarAMesaRpcError", () => {
  it("mapea monto faltante (legado decisión pendiente)", () => {
    const err = mapEnviarAMesaRpcError({
      message: "enviar_a_mesa: decisión del editor debe ser aprobado (actual: pendiente)",
    });
    assert.ok(err instanceof ExpedientesSupabaseError);
    assert.match(err.message, /monto aprobado/i);
  });

  it("mapea falta decisión del editor", () => {
    const err = mapEnviarAMesaRpcError({
      message: "enviar_a_mesa: falta decisión del editor",
    });
    assert.match(err.message, /monto aprobado/i);
  });

  it("mapea monto faltante", () => {
    const err = mapEnviarAMesaRpcError({
      message: "enviar_a_mesa: monto aprobado del editor debe ser mayor a 0",
    });
    assert.match(err.message, /monto aprobado/i);
  });

  it("mapea cliente_datos faltantes", () => {
    const err = mapEnviarAMesaRpcError({
      message: "enviar_a_mesa: faltan datos del cliente",
    });
    assert.match(err.message, /faltan los datos del cliente/i);
  });

  it("mapea RFC faltante", () => {
    const err = mapEnviarAMesaRpcError({
      message: "enviar_a_mesa: RFC del cliente es obligatorio",
    });
    assert.match(err.message, /RFC del cliente es obligatorio/i);
  });

  it("mapea datos cliente incompletos", () => {
    const err = mapEnviarAMesaRpcError({
      message:
        "enviar_a_mesa: datos del cliente deben estar completos o validados (actual: pendiente)",
    });
    assert.match(err.message, /completos o validados/i);
  });

  it("mapea documentos incompletos", () => {
    const err = mapEnviarAMesaRpcError({
      message: "enviar_a_mesa: faltan documentos obligatorios de integración (3 de 5)",
    });
    assert.match(err.message, /documentos obligatorios de integración/i);
  });

  it("mapea ya enviado", () => {
    const err = mapEnviarAMesaRpcError({
      message: "enviar_a_mesa: el expediente ya fue enviado a Mesa",
    });
    assert.match(err.message, /ya fue enviado a Mesa/i);
  });

  it("mapea no autorizado por código 42501", () => {
    const err = mapEnviarAMesaRpcError({
      code: "42501",
      message: "permission denied",
    });
    assert.match(err.message, /permiso/i);
  });

  it("mapea expediente no encontrado", () => {
    const err = mapEnviarAMesaRpcError({
      code: "P0002",
      message: "enviar_a_mesa: expediente no encontrado",
    });
    assert.match(err.message, /no encontrado/i);
  });

  it("mapea error inesperado", () => {
    const err = mapEnviarAMesaRpcError({
      message: "algo totalmente desconocido",
    });
    assert.match(err.message, /no se pudo enviar a Mesa/i);
  });
});
