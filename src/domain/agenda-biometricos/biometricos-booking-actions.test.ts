import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowAsesorBiometricosSupabaseCard,
  canShowBiometricosManageActions,
} from "./biometricos-booking-actions";

describe("canShowBiometricosManageActions", () => {
  it("muestra acciones en etapa 3 con booking activo", () => {
    assert.equal(
      canShowBiometricosManageActions({ etapaActual: 3, hasActiveBooking: true }),
      true,
    );
  });

  it("muestra acciones en etapa 4 con booking activo", () => {
    assert.equal(
      canShowBiometricosManageActions({ etapaActual: 4, hasActiveBooking: true }),
      true,
    );
  });

  it("oculta acciones en etapa 5", () => {
    assert.equal(
      canShowBiometricosManageActions({ etapaActual: 5, hasActiveBooking: true }),
      false,
    );
  });

  it("oculta acciones sin booking activo", () => {
    assert.equal(
      canShowBiometricosManageActions({ etapaActual: 4, hasActiveBooking: false }),
      false,
    );
  });

  it("oculta acciones en etapa 3 sin booking activo", () => {
    assert.equal(
      canShowBiometricosManageActions({ etapaActual: 3, hasActiveBooking: false }),
      false,
    );
  });
});

describe("canShowAsesorBiometricosSupabaseCard", () => {
  it("etapa 3 siempre si enviado a Mesa", () => {
    assert.equal(
      canShowAsesorBiometricosSupabaseCard({ submittedToMesa: true, etapaActual: 3 }),
      true,
    );
  });

  it("etapa 4 siempre si enviado a Mesa", () => {
    assert.equal(
      canShowAsesorBiometricosSupabaseCard({ submittedToMesa: true, etapaActual: 4 }),
      true,
    );
  });

  it("etapa 5 tras cancelación Mesa sin booking activo", () => {
    assert.equal(
      canShowAsesorBiometricosSupabaseCard({
        submittedToMesa: true,
        etapaActual: 5,
        hasActiveBooking: false,
        hasLastCancelledBooking: true,
      }),
      true,
    );
  });

  it("etapa 5 sin cancelación previa no muestra card", () => {
    assert.equal(
      canShowAsesorBiometricosSupabaseCard({
        submittedToMesa: true,
        etapaActual: 5,
        hasActiveBooking: false,
        hasLastCancelledBooking: false,
      }),
      false,
    );
  });

  it("etapa 5 con booking activo no muestra card", () => {
    assert.equal(
      canShowAsesorBiometricosSupabaseCard({
        submittedToMesa: true,
        etapaActual: 5,
        hasActiveBooking: true,
        hasLastCancelledBooking: true,
      }),
      false,
    );
  });
});
