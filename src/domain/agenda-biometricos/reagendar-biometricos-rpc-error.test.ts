import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapReagendarBiometricosRpcError } from "./reagendar-biometricos-rpc-error";

describe("mapReagendarBiometricosRpcError", () => {
  it("mapea sin cita activa", () => {
    const err = mapReagendarBiometricosRpcError({
      message: "reagendar_biometricos: no hay cita biométrica activa para reagendar",
    });
    assert.match(err.message, /no hay una cita biométrica activa/i);
  });

  it("mapea etapa incorrecta", () => {
    const err = mapReagendarBiometricosRpcError({
      message: "reagendar_biometricos: solo se puede reagendar en etapa 4 (actual: 5)",
    });
    assert.match(err.message, /etapa 4/i);
  });

  it("mapea conflicto de cupo", () => {
    const err = mapReagendarBiometricosRpcError({
      message: "reagendar_biometricos: conflicto al crear la nueva cita biométrica",
    });
    assert.equal(
      err.message,
      "Este horario ya fue apartado. Selecciona otro horario.",
    );
  });

  it("delega cupo agotado de agenda_config al mapper de book", () => {
    const err = mapReagendarBiometricosRpcError({
      message: "reagendar_biometricos: agenda_config: cupo agotado",
    });
    assert.equal(
      err.message,
      "Este horario ya fue apartado. Selecciona otro horario.",
    );
  });
});
