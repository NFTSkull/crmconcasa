import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOGIN_EMAIL_ASESOR_MEJORAVIT,
  MSG_LOGIN_IDENTIFICADOR_INVALIDO,
  MSG_LOGIN_IDENTIFICADOR_VACIO,
  normalizeLoginIdentifier,
} from "./normalizeLoginIdentifier";

describe("normalizeLoginIdentifier", () => {
  it("alias exacto asesor.mejoravit → correo interno", () => {
    assert.equal(normalizeLoginIdentifier("asesor.mejoravit"), LOGIN_EMAIL_ASESOR_MEJORAVIT);
    assert.equal(normalizeLoginIdentifier("  ASESOR.MEJORAVIT  "), LOGIN_EMAIL_ASESOR_MEJORAVIT);
  });

  it("correo con @ se conserva en minúsculas (flujo normal)", () => {
    assert.equal(
      normalizeLoginIdentifier("Usuario@ConCasa.mx"),
      "usuario@concasa.mx",
    );
    assert.equal(
      normalizeLoginIdentifier(LOGIN_EMAIL_ASESOR_MEJORAVIT),
      LOGIN_EMAIL_ASESOR_MEJORAVIT,
    );
  });

  it("rechaza usernames no autorizados (coincidencia exacta)", () => {
    for (const bad of [
      "asesor.mejoravit.otro",
      "xasesor.mejoravit",
      "asesor",
      "mejoravit",
    ]) {
      assert.throws(
        () => normalizeLoginIdentifier(bad),
        (err: unknown) =>
          err instanceof Error && err.message === MSG_LOGIN_IDENTIFICADOR_INVALIDO,
        bad,
      );
    }
  });

  it("rechaza vacío / solo espacios", () => {
    assert.throws(
      () => normalizeLoginIdentifier(""),
      (err: unknown) =>
        err instanceof Error && err.message === MSG_LOGIN_IDENTIFICADOR_VACIO,
    );
    assert.throws(
      () => normalizeLoginIdentifier("   "),
      (err: unknown) =>
        err instanceof Error && err.message === MSG_LOGIN_IDENTIFICADOR_VACIO,
    );
  });
});
