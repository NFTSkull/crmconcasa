import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapBookBiometricosRpcError } from "./book-biometricos-rpc-error";

describe("mapBookBiometricosRpcError", () => {
  it("mapea sesión expirada", () => {
    const err = mapBookBiometricosRpcError({
      code: "42501",
      message: "book_biometricos: usuario no autenticado",
    });
    assert.match(err.message, /sesión expiró/i);
  });

  it("mapea asesor no dueño", () => {
    const err = mapBookBiometricosRpcError({
      message: "book_biometricos: solo el asesor dueño puede agendar biométricos",
    });
    assert.match(err.message, /asesor dueño/i);
  });

  it("mapea etapa incorrecta", () => {
    const err = mapBookBiometricosRpcError({
      message: "book_biometricos: solo se puede agendar en etapa 4 (actual: 3)",
    });
    assert.match(err.message, /etapa 4/i);
  });

  it("mapea cita activa existente", () => {
    const err = mapBookBiometricosRpcError({
      message: "book_biometricos: ya existe una cita biométrica activa para este expediente",
    });
    assert.match(err.message, /ya tiene una cita/i);
  });

  it("mapea cupo agotado", () => {
    const err = mapBookBiometricosRpcError({
      message: "agenda_config: cupo agotado",
    });
    assert.match(err.message, /cupo/i);
  });

  it("mapea anticipación mínima", () => {
    const err = mapBookBiometricosRpcError({
      message: "agenda_config: fecha no cumple anticipación mínima",
    });
    assert.match(err.message, /anticipación mínima/i);
  });
});
