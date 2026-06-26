import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canMesaCancelBiometricosBooking,
  canMesaCancelFirmasBooking,
  canMesaRoleCancelAgendaRpc,
  canMesaShowCancelCitaButton,
} from "./mesaAgendaCancelAccess";

describe("canMesaRoleCancelAgendaRpc", () => {
  it("todos los roles Mesa y super_admin", () => {
    assert.equal(canMesaRoleCancelAgendaRpc("mesa_control_admin"), true);
    assert.equal(canMesaRoleCancelAgendaRpc("mesa_control_interno"), true);
    assert.equal(canMesaRoleCancelAgendaRpc("mesa_control_externo"), true);
    assert.equal(canMesaRoleCancelAgendaRpc("super_admin"), true);
  });

  it("asesor no", () => {
    assert.equal(canMesaRoleCancelAgendaRpc("asesor"), false);
  });
});

describe("canMesaCancelFirmasBooking", () => {
  it("etapa 9/10 con booking y mesa admin", () => {
    assert.equal(
      canMesaCancelFirmasBooking({
        mockRole: "mesa_control_admin",
        etapaActual: 9,
        hasActiveBooking: true,
      }),
      true,
    );
    assert.equal(
      canMesaCancelFirmasBooking({
        mockRole: "mesa_control_interno",
        etapaActual: 10,
        hasActiveBooking: true,
      }),
      true,
    );
  });

  it("sin booking no muestra botón", () => {
    assert.equal(
      canMesaCancelFirmasBooking({
        mockRole: "mesa_control_admin",
        etapaActual: 9,
        hasActiveBooking: false,
      }),
      false,
    );
  });

  it("etapa 4 no aplica firmas", () => {
    assert.equal(
      canMesaShowCancelCitaButton({
        kind: "firmas",
        mockRole: "mesa_control_admin",
        etapaActual: 4,
        hasActiveBooking: true,
      }),
      false,
    );
  });
});

describe("canMesaCancelBiometricosBooking", () => {
  it("etapa 4/5 con booking activo", () => {
    assert.equal(
      canMesaCancelBiometricosBooking({
        mockRole: "mesa_control_admin",
        etapaActual: 4,
        hasActiveBooking: true,
      }),
      true,
    );
    assert.equal(
      canMesaCancelBiometricosBooking({
        mockRole: "mesa_control_externo",
        etapaActual: 5,
        hasActiveBooking: true,
      }),
      true,
    );
  });

  it("sin booking no muestra botón", () => {
    assert.equal(
      canMesaCancelBiometricosBooking({
        mockRole: "mesa_control_admin",
        etapaActual: 4,
        hasActiveBooking: false,
      }),
      false,
    );
  });

  it("etapa 6 no aplica biométricos", () => {
    assert.equal(
      canMesaShowCancelCitaButton({
        kind: "biometricos",
        mockRole: "mesa_control_admin",
        etapaActual: 6,
        hasActiveBooking: true,
      }),
      false,
    );
  });
});
