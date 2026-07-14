import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapConvertBiometricosToNotificacionRpcError } from "./convert-biometricos-to-notificacion-rpc-error";

describe("mapConvertBiometricosToNotificacionRpcError", () => {
  it("mapea owner / etapa / fecha / sin bio", () => {
    assert.match(
      mapConvertBiometricosToNotificacionRpcError({
        message: "convert_biometricos_to_notificacion: solo el asesor dueño puede convertir",
      }).message,
      /dueño/i,
    );
    assert.match(
      mapConvertBiometricosToNotificacionRpcError({
        message: "convert_biometricos_to_notificacion: solo etapas 3 o 4 (actual: 5)",
      }).message,
      /etapa 3 o 4/i,
    );
    assert.match(
      mapConvertBiometricosToNotificacionRpcError({
        message: "convert_biometricos_to_notificacion: la fecha debe ser futura",
      }).message,
      /futura/i,
    );
    assert.match(
      mapConvertBiometricosToNotificacionRpcError({
        message: "convert_biometricos_to_notificacion: no hay cita biométrica activa",
      }).message,
      /biométrica activa/i,
    );
  });
});
