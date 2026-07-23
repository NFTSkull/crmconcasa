import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canMesaCancelarCitaYContinuar,
  MESA_GESTIONAR_CANCELAR_CONTINUAR_CONFIRM,
  mesaCancelarContinuarDestinoLabel,
} from "./mesaAgendaCitasUi";
import { formatAgendaDecisionLabel, isCancelContinueDecision } from "@/domain/agenda-booking-decisiones";

describe("canMesaCancelarCitaYContinuar (P118b)", () => {
  it("bio etapa 4 + mesa_admin", () => {
    assert.equal(
      canMesaCancelarCitaYContinuar({
        kind: "biometricos",
        etapaActual: 4,
        status: "booked",
        role: "mesa_admin",
      }),
      true,
    );
    assert.equal(
      canMesaCancelarCitaYContinuar({
        kind: "biometricos",
        etapaActual: 4,
        status: "booked",
        role: "mesa_control_admin",
      }),
      true,
    );
  });

  it("firmas etapa 10 + super_admin", () => {
    assert.equal(
      canMesaCancelarCitaYContinuar({
        kind: "firmas",
        etapaActual: 10,
        status: "booked",
        role: "super_admin",
      }),
      true,
    );
  });

  it("oculta notificación, firmas 9, interno/asesor", () => {
    assert.equal(
      canMesaCancelarCitaYContinuar({
        kind: "notificacion",
        etapaActual: 3,
        status: "booked",
        role: "mesa_admin",
      }),
      false,
    );
    assert.equal(
      canMesaCancelarCitaYContinuar({
        kind: "firmas",
        etapaActual: 9,
        status: "booked",
        role: "mesa_admin",
      }),
      false,
    );
    assert.equal(
      canMesaCancelarCitaYContinuar({
        kind: "biometricos",
        etapaActual: 4,
        status: "booked",
        role: "mesa_interno",
      }),
      false,
    );
    assert.equal(
      canMesaCancelarCitaYContinuar({
        kind: "biometricos",
        etapaActual: 4,
        status: "booked",
        role: "asesor",
      }),
      false,
    );
  });

  it("destino labels", () => {
    assert.match(
      mesaCancelarContinuarDestinoLabel({ kind: "biometricos", etapaActual: 4 }),
      /Biometría/,
    );
    assert.match(
      mesaCancelarContinuarDestinoLabel({ kind: "firmas", etapaActual: 10 }),
      /Firmado/,
    );
  });

  it("confirm copy presente", () => {
    assert.match(MESA_GESTIONAR_CANCELAR_CONTINUAR_CONFIRM, /avanzará sin realizarla/i);
  });
});

describe("formatAgendaDecisionLabel cancel_continue", () => {
  it("copy asesor", () => {
    assert.equal(isCancelContinueDecision("cancel_continue"), true);
    assert.match(
      formatAgendaDecisionLabel("cancel_continue"),
      /autorizó continuar/i,
    );
  });
});
