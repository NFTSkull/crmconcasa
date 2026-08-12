import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CAMBIAR_PROGRAMA_OPTIONS,
  canShowAsesorReprecalActions,
  isSameProgramaUi,
  messageForNuevaChangeProgramaBlocked,
  messageForUnexpectedGateFromDetalle,
  opcionesCambioPrograma,
  validateGateForDetalleReprecal,
} from "./asesor-reprecal-flow";
import { newReprecalIdempotencyKey } from "./reprecal-idempotency";
import type { NssPrecalGateResult } from "./nss-precal-gate";

const EXP_ID = "8305e3e3-3e66-4d0a-96e6-baf161a3b55a";

function gate(
  partial: Partial<NssPrecalGateResult> & Pick<NssPrecalGateResult, "status">,
): NssPrecalGateResult {
  return {
    message: partial.message ?? "ok",
    expediente_id: partial.expediente_id ?? EXP_ID,
    nss: "99115500001",
    ...partial,
  };
}

describe("asesor-reprecal-flow P164 UI", () => {
  it("muestra acciones solo con supabase + mesa + no cancelado", () => {
    assert.equal(
      canShowAsesorReprecalActions({
        dataSupabase: true,
        submittedToMesa: true,
        cicloEstado: "activo",
      }),
      true,
    );
    assert.equal(
      canShowAsesorReprecalActions({
        dataSupabase: false,
        submittedToMesa: true,
      }),
      false,
    );
    assert.equal(
      canShowAsesorReprecalActions({
        dataSupabase: true,
        submittedToMesa: false,
      }),
      false,
    );
    assert.equal(
      canShowAsesorReprecalActions({
        dataSupabase: true,
        submittedToMesa: true,
        cicloEstado: "cancelado",
      }),
      false,
    );
  });

  it("opciones cambio: Mejoravit/Compro; excluye vigente; subcuenta puede elegir ambas", () => {
    assert.deepEqual([...CAMBIAR_PROGRAMA_OPTIONS], [
      "Mejoravit",
      "Compro tu casa",
    ]);
    assert.deepEqual(opcionesCambioPrograma("Mejoravit"), ["Compro tu casa"]);
    assert.deepEqual(opcionesCambioPrograma("Compro tu casa"), ["Mejoravit"]);
    assert.deepEqual(opcionesCambioPrograma("Subcuenta"), [
      "Mejoravit",
      "Compro tu casa",
    ]);
    assert.equal(isSameProgramaUi("Mejoravit", "mejoravit"), true);
    assert.equal(isSameProgramaUi("Mejoravit", "Compro tu casa"), false);
  });

  it("nueva precal: gate own_mesa + mismo expediente OK", () => {
    assert.equal(
      validateGateForDetalleReprecal({
        mode: "same_programa",
        gate: gate({ status: "reprecal_own_mesa" }),
        expedienteId: EXP_ID,
      }),
      null,
    );
  });

  it("cambio programa: exige reprecal_change_programa", () => {
    assert.equal(
      validateGateForDetalleReprecal({
        mode: "change_programa",
        gate: gate({
          status: "reprecal_change_programa",
          programa_actual: "mejoravit",
          programa_solicitado: "compro_tu_casa",
          cambio_programa: true,
        }),
        expedienteId: EXP_ID,
      }),
      null,
    );
    assert.match(
      validateGateForDetalleReprecal({
        mode: "change_programa",
        gate: gate({ status: "reprecal_own_mesa" }),
        expedienteId: EXP_ID,
      }) ?? "",
      /inesperado|own_mesa/i,
    );
  });

  it("other asesor / ambiguous / ok_create / mismatch no inician", () => {
    assert.match(
      validateGateForDetalleReprecal({
        mode: "same_programa",
        gate: gate({ status: "blocked_other_asesor" }),
        expedienteId: EXP_ID,
      }) ?? "",
      /otro asesor/i,
    );
    assert.match(
      validateGateForDetalleReprecal({
        mode: "same_programa",
        gate: gate({ status: "blocked_ambiguous" }),
        expedienteId: EXP_ID,
      }) ?? "",
      /único expediente/i,
    );
    assert.match(
      validateGateForDetalleReprecal({
        mode: "same_programa",
        gate: gate({ status: "ok_create" }),
        expedienteId: EXP_ID,
      }) ?? "",
      /No se pudo reutilizar/i,
    );
    assert.equal(
      messageForUnexpectedGateFromDetalle("ok_create").includes("reutilizar"),
      true,
    );
    assert.ok(
      validateGateForDetalleReprecal({
        mode: "change_programa",
        gate: gate({ status: "blocked_programa_mismatch" }),
        expedienteId: EXP_ID,
      }),
    );
  });

  it("expediente_id distinto al actual bloquea", () => {
    assert.match(
      validateGateForDetalleReprecal({
        mode: "same_programa",
        gate: gate({
          status: "reprecal_own_mesa",
          expediente_id: "11111111-1111-4111-8111-111111111111",
        }),
        expedienteId: EXP_ID,
      }) ?? "",
      /no coincide/i,
    );
  });

  it("nueva page: mensaje bloquea create ante change programa", () => {
    assert.match(messageForNuevaChangeProgramaBlocked(), /Cambiar programa/);
    assert.doesNotMatch(messageForNuevaChangeProgramaBlocked(), /crear otro/i);
  });

  it("idempotency key estable por llamada distinta", () => {
    const a = newReprecalIdempotencyKey();
    const b = newReprecalIdempotencyKey();
    assert.ok(a.length > 8);
    assert.notEqual(a, b);
  });
});
