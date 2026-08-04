import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MSG_NSS_AMBIGUOUS,
  MSG_NSS_OTHER_ASESOR,
  MSG_NSS_OWN_MESA_REPRECAL,
  MSG_NSS_PROGRAMA_MISMATCH,
  iniciarReprecalificacionResultSchema,
  isNssPrecalGateBlocked,
  messageForNssPrecalGateStatus,
  nssPrecalGateResultSchema,
} from "./nss-precal-gate";

describe("nss-precal-gate P155", () => {
  it("parsea gate reprecal_own_mesa", () => {
    const parsed = nssPrecalGateResultSchema.parse({
      status: "reprecal_own_mesa",
      message: MSG_NSS_OWN_MESA_REPRECAL,
      expediente_id: "8305e3e3-3e66-4d0a-96e6-baf161a3b55a",
      nss: "69149612827",
      programa: "mejoravit",
      reprecalificacion_pendiente_id: null,
    });
    assert.equal(parsed.status, "reprecal_own_mesa");
    assert.equal(parsed.expediente_id, "8305e3e3-3e66-4d0a-96e6-baf161a3b55a");
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
  });

  it("isNssPrecalGateBlocked", () => {
    assert.equal(isNssPrecalGateBlocked("ok_create"), false);
    assert.equal(isNssPrecalGateBlocked("reprecal_own_mesa"), false);
    assert.equal(isNssPrecalGateBlocked("blocked_other_asesor"), true);
    assert.equal(isNssPrecalGateBlocked("blocked_ambiguous"), true);
    assert.equal(isNssPrecalGateBlocked("blocked_programa_mismatch"), true);
  });

  it("parsea resultado iniciar reprecal", () => {
    const parsed = iniciarReprecalificacionResultSchema.parse({
      ok: true,
      idempotent: false,
      expediente_id: "8305e3e3-3e66-4d0a-96e6-baf161a3b55a",
      intento_id: "11111111-1111-4111-8111-111111111111",
      status: "reprecal_pending",
      message: "Se guardó una nueva precalificación en el expediente existente.",
      programa: "mejoravit",
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.expediente_id, "8305e3e3-3e66-4d0a-96e6-baf161a3b55a");
  });
});
