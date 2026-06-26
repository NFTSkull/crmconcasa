import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canMesaCancelBiometricosBooking,
  canMesaCancelFirmasBooking,
  canMesaRoleCancelAgendaRpc,
  canMesaShowCancelCitaButton,
  canMesaShowCancelCitaOperativa,
  explainMesaShowCancelCitaOperativa,
  resolveMesaAgendaCancelRole,
} from "./mesaAgendaCancelAccess";

describe("canMesaRoleCancelAgendaRpc", () => {
  it("roles Mesa mock y Supabase", () => {
    assert.equal(canMesaRoleCancelAgendaRpc("mesa_control_admin"), true);
    assert.equal(canMesaRoleCancelAgendaRpc("mesa_control_interno"), true);
    assert.equal(canMesaRoleCancelAgendaRpc("mesa_control_externo"), true);
    assert.equal(canMesaRoleCancelAgendaRpc("mesa_admin"), true);
    assert.equal(canMesaRoleCancelAgendaRpc("mesa_interno"), true);
    assert.equal(canMesaRoleCancelAgendaRpc("mesa_externo"), true);
    assert.equal(canMesaRoleCancelAgendaRpc("super_admin"), true);
  });

  it("asesor no", () => {
    assert.equal(canMesaRoleCancelAgendaRpc("asesor"), false);
  });
});

describe("canMesaShowCancelCitaOperativa", () => {
  const baseBio = {
    kind: "biometricos" as const,
    mockRole: "mesa_admin",
    submittedToMesa: true,
    subestado: "en_proceso",
    cicloEstado: "activo",
    hasActiveBooking: true,
  };

  it("etapa 5 biométricos con booking activo", () => {
    assert.equal(
      canMesaShowCancelCitaOperativa({ ...baseBio, etapaActual: 5 }),
      true,
    );
  });

  it("etapa 10 firmas con booking activo", () => {
    assert.equal(
      canMesaShowCancelCitaOperativa({
        kind: "firmas",
        mockRole: "mesa_interno",
        submittedToMesa: true,
        subestado: "en_proceso",
        cicloEstado: "activo",
        etapaActual: 10,
        hasActiveBooking: true,
      }),
      true,
    );
  });

  it("sin subestado en_proceso no muestra", () => {
    assert.equal(
      canMesaShowCancelCitaOperativa({
        ...baseBio,
        etapaActual: 5,
        subestado: "pendiente",
      }),
      false,
    );
  });

  it("sin booking activo no muestra", () => {
    assert.equal(
      canMesaShowCancelCitaOperativa({
        ...baseBio,
        etapaActual: 5,
        hasActiveBooking: false,
      }),
      false,
    );
  });

  it("no enviado a Mesa no muestra", () => {
    assert.equal(
      canMesaShowCancelCitaOperativa({
        ...baseBio,
        etapaActual: 5,
        submittedToMesa: false,
      }),
      false,
    );
  });

  it("fixture Cloud 99903805001: mockRole null + sessionRole mesa_control", () => {
    const explain = explainMesaShowCancelCitaOperativa({
      kind: "biometricos",
      mockRole: null,
      sessionRole: "mesa_control",
      submittedToMesa: true,
      subestado: "en_proceso",
      cicloEstado: "activo",
      etapaActual: 5,
      hasActiveBooking: true,
      fechaCita: "2026-06-20T15:00:00.000Z",
    });
    assert.equal(explain.visible, true, explain.failedChecks.join(", "));
    assert.equal(explain.failedChecks.length, 0);
    assert.equal(resolveMesaAgendaCancelRole({ mockRole: null, sessionRole: "mesa_control" }), "mesa_control");
  });

  it("mockRole null sin sessionRole falla en rol", () => {
    const explain = explainMesaShowCancelCitaOperativa({
      kind: "biometricos",
      mockRole: null,
      sessionRole: null,
      submittedToMesa: true,
      subestado: "en_proceso",
      cicloEstado: "activo",
      etapaActual: 5,
      hasActiveBooking: true,
      fechaCita: "2026-06-20T15:00:00.000Z",
    });
    assert.equal(explain.visible, false);
    assert.deepEqual(explain.failedChecks, ["rol"]);
  });

  it("fecha_cita sin booking activo sí muestra", () => {
    assert.equal(
      canMesaShowCancelCitaOperativa({
        ...baseBio,
        etapaActual: 5,
        hasActiveBooking: false,
        fechaCita: "2026-06-20T15:00:00.000Z",
      }),
      true,
    );
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
