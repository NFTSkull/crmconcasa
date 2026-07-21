import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cancelacionOperativaInputSchema,
  esElegibleCancelacionOperativa,
  esExpedienteCancelado,
  getMesaCancelacionErrorCode,
  mapMesaCancelacionRpcError,
} from "./mesa-cancelacion-operativa";

describe("mesa-cancelacion-operativa", () => {
  it("Zod exige motivo no vacío y acota longitudes", () => {
    assert.equal(
      cancelacionOperativaInputSchema.safeParse({ motivo: "  " }).success,
      false,
    );
    assert.equal(
      cancelacionOperativaInputSchema.safeParse({ motivo: "Cliente abandona" })
        .success,
      true,
    );
    assert.equal(
      cancelacionOperativaInputSchema.safeParse({
        motivo: "x".repeat(501),
      }).success,
      false,
    );
  });

  it("elegible solo con Supabase + enviado + ciclo activo", () => {
    assert.equal(
      esElegibleCancelacionOperativa({
        dataModeSupabase: true,
        submittedToMesa: true,
        cicloEstado: "activo",
      }),
      true,
    );
    assert.equal(
      esElegibleCancelacionOperativa({
        dataModeSupabase: true,
        submittedToMesa: true,
        cicloEstado: "cancelado",
      }),
      false,
    );
    assert.equal(
      esElegibleCancelacionOperativa({
        dataModeSupabase: false,
        submittedToMesa: true,
        cicloEstado: "activo",
      }),
      false,
    );
  });

  it("esExpedienteCancelado solo por ciclo", () => {
    assert.equal(esExpedienteCancelado("cancelado"), true);
    assert.equal(esExpedienteCancelado("activo"), false);
    assert.equal(esExpedienteCancelado("rechazado"), false);
  });

  it("mapea errores MESA_CANCEL_EXP_*", () => {
    assert.equal(
      getMesaCancelacionErrorCode({
        message: "MESA_CANCEL_EXP_ALREADY_CANCELLED: ya",
      }),
      "MESA_CANCEL_EXP_ALREADY_CANCELLED",
    );
    const err = mapMesaCancelacionRpcError({
      message: "MESA_CANCEL_EXP_REASON_REQUIRED: motivo",
    });
    assert.match(err.message, /motivo/i);
  });
});
