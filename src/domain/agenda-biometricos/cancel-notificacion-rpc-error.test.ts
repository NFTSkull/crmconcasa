import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapCancelNotificacionRpcError } from "./cancel-notificacion-rpc-error";
import { mapReagendarNotificacionRpcError } from "./reagendar-notificacion-rpc-error";

describe("mapCancelNotificacionRpcError", () => {
  it("mapea sin notificación activa", () => {
    const err = mapCancelNotificacionRpcError({
      message: "cancel_notificacion_etapa3: no hay notificación activa para cancelar",
    });
    assert.match(err.message, /notificación activa/i);
  });
});

describe("mapReagendarNotificacionRpcError", () => {
  it("mapea etapa incorrecta", () => {
    const err = mapReagendarNotificacionRpcError({
      message: "reagendar_notificacion_etapa3: solo se puede reagendar en etapa 3 (actual: 4)",
    });
    assert.match(err.message, /etapa 3/i);
  });
});
