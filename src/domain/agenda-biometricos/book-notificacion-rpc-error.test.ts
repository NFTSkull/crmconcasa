import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapBookNotificacionRpcError } from "./book-notificacion-rpc-error";

describe("mapBookNotificacionRpcError", () => {
  it("mapea sesión expirada", () => {
    const err = mapBookNotificacionRpcError({
      code: "42501",
      message: "book_notificacion_etapa3: usuario no autenticado",
    });
    assert.match(err.message, /sesión expiró/i);
  });

  it("mapea notificación duplicada", () => {
    const err = mapBookNotificacionRpcError({
      message: "book_notificacion_etapa3: ya existe una notificación activa para este expediente",
    });
    assert.match(err.message, /notificación activa/i);
  });

  it("mapea conflicto con biométricos", () => {
    const err = mapBookNotificacionRpcError({
      message: "book_notificacion_etapa3: ya existe una cita biométrica activa para este expediente",
    });
    assert.match(err.message, /biométrica activa/i);
  });

  it("mapea etapa incorrecta", () => {
    const err = mapBookNotificacionRpcError({
      message: "book_notificacion_etapa3: solo se puede agendar en etapa 3 (actual: 4)",
    });
    assert.match(err.message, /etapa 3/i);
  });
});
