import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildActualizarMontoMejoravitRpcArgs,
  buildGetMontoMejoravitContextRpcArgs,
  MontoMejoravitSupabaseError,
} from "./repo";

describe("RPC wrappers P090 — payloads", () => {
  it("lectura usa get_expediente_monto_mejoravit_context args", () => {
    assert.deepEqual(
      buildGetMontoMejoravitContextRpcArgs("exp-1"),
      { p_expediente_id: "exp-1" },
    );
  });

  it("escritura usa mesa_actualizar_monto_mejoravit args (no save_cliente_datos)", () => {
    const args = buildActualizarMontoMejoravitRpcArgs({
      expedienteId: "exp-1",
      montoNuevo: 200000,
      motivo: "Ajuste Infonavit",
    });
    assert.deepEqual(args, {
      p_expediente_id: "exp-1",
      p_monto_nuevo: 200000,
      p_motivo: "Ajuste Infonavit",
    });
    assert.equal(
      Object.keys(args).includes("p_datos"),
      false,
      "no debe parecerse a save_cliente_datos",
    );
  });

  it("MontoMejoravitSupabaseError", () => {
    const err = new MontoMejoravitSupabaseError("x");
    assert.equal(err.name, "MontoMejoravitSupabaseError");
  });
});
