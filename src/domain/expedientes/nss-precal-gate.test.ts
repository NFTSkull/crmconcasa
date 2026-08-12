import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MSG_NSS_AMBIGUOUS,
  MSG_NSS_CHANGE_PROGRAMA,
  MSG_NSS_OTHER_ASESOR,
  MSG_NSS_OWN_MESA_REPRECAL,
  MSG_NSS_PROGRAMA_MISMATCH,
  iniciarReprecalificacionResultSchema,
  isNssPrecalGateBlocked,
  isNssPrecalGateReprecalAllowed,
  messageForNssPrecalGateStatus,
  nssPrecalGateResultSchema,
} from "./nss-precal-gate";

describe("nss-precal-gate P155/P164", () => {
  it("parsea gate reprecal_own_mesa (misma reprecal)", () => {
    const parsed = nssPrecalGateResultSchema.parse({
      status: "reprecal_own_mesa",
      message: MSG_NSS_OWN_MESA_REPRECAL,
      expediente_id: "8305e3e3-3e66-4d0a-96e6-baf161a3b55a",
      nss: "69149612827",
      programa: "mejoravit",
      programa_actual: "mejoravit",
      programa_solicitado: "mejoravit",
      cambio_programa: false,
      reprecalificacion_pendiente_id: null,
    });
    assert.equal(parsed.status, "reprecal_own_mesa");
    assert.equal(parsed.programa_solicitado, "mejoravit");
    assert.equal(parsed.cambio_programa, false);
    assert.equal(isNssPrecalGateReprecalAllowed(parsed.status), true);
  });

  it("parsea gate reprecal_change_programa", () => {
    const parsed = nssPrecalGateResultSchema.parse({
      status: "reprecal_change_programa",
      message: MSG_NSS_CHANGE_PROGRAMA,
      expediente_id: "8305e3e3-3e66-4d0a-96e6-baf161a3b55a",
      nss: "69149612827",
      programa: "mejoravit",
      programa_actual: "mejoravit",
      programa_solicitado: "compro_tu_casa",
      cambio_programa: true,
      reprecalificacion_pendiente_id: null,
    });
    assert.equal(parsed.status, "reprecal_change_programa");
    assert.equal(parsed.programa_actual, "mejoravit");
    assert.equal(parsed.programa_solicitado, "compro_tu_casa");
    assert.equal(parsed.cambio_programa, true);
    assert.equal(isNssPrecalGateBlocked(parsed.status), false);
    assert.equal(isNssPrecalGateReprecalAllowed(parsed.status), true);
  });

  it("mensajes canónicos por status", () => {
    assert.equal(
      messageForNssPrecalGateStatus("blocked_other_asesor"),
      MSG_NSS_OTHER_ASESOR,
    );
    assert.equal(
      messageForNssPrecalGateStatus("blocked_ambiguous"),
      MSG_NSS_AMBIGUOUS,
    );
    assert.equal(
      messageForNssPrecalGateStatus("blocked_programa_mismatch"),
      MSG_NSS_PROGRAMA_MISMATCH,
    );
    assert.equal(
      messageForNssPrecalGateStatus("reprecal_own_mesa"),
      MSG_NSS_OWN_MESA_REPRECAL,
    );
    assert.equal(
      messageForNssPrecalGateStatus("reprecal_change_programa"),
      MSG_NSS_CHANGE_PROGRAMA,
    );
  });

  it("isNssPrecalGateBlocked", () => {
    assert.equal(isNssPrecalGateBlocked("ok_create"), false);
    assert.equal(isNssPrecalGateBlocked("reprecal_own_mesa"), false);
    assert.equal(isNssPrecalGateBlocked("reprecal_change_programa"), false);
    assert.equal(isNssPrecalGateBlocked("blocked_other_asesor"), true);
    assert.equal(isNssPrecalGateBlocked("blocked_ambiguous"), true);
    assert.equal(isNssPrecalGateBlocked("blocked_programa_mismatch"), true);
  });

  it("parsea resultado iniciar reprecal con cambio_programa", () => {
    const same = iniciarReprecalificacionResultSchema.parse({
      ok: true,
      idempotent: false,
      expediente_id: "8305e3e3-3e66-4d0a-96e6-baf161a3b55a",
      intento_id: "11111111-1111-4111-8111-111111111111",
      status: "reprecal_pending",
      message: "Se guardó una nueva precalificación en el expediente existente.",
      programa: "mejoravit",
      programa_solicitado: "mejoravit",
      cambio_programa: false,
    });
    assert.equal(same.cambio_programa, false);
    assert.equal(same.programa_solicitado, "mejoravit");

    const change = iniciarReprecalificacionResultSchema.parse({
      ok: true,
      idempotent: false,
      expediente_id: "8305e3e3-3e66-4d0a-96e6-baf161a3b55a",
      intento_id: "22222222-2222-4222-8222-222222222222",
      status: "reprecal_pending",
      message: "Se solicitó cambio de programa en el expediente existente.",
      programa: "mejoravit",
      programa_solicitado: "compro_tu_casa",
      cambio_programa: true,
    });
    assert.equal(change.cambio_programa, true);
    assert.equal(change.programa, "mejoravit");
    assert.equal(change.programa_solicitado, "compro_tu_casa");
  });
});
