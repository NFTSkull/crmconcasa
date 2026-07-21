import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminEstadoRpcParam,
  esAdminCanceladoOperativo,
  esAdminRechazadoOperativo,
  matchesAdminEstadoFilter,
} from "./admin-estado-filter";

describe("admin-estado-filter — P094", () => {
  const activoRechazado = {
    cicloEstado: "activo",
    subestado: "rechazado",
    etapaActual: 5,
  };
  const cancelado = {
    cicloEstado: "cancelado",
    subestado: "en_proceso",
    etapaActual: 3,
  };
  const canceladoConRechazo = {
    cicloEstado: "cancelado",
    subestado: "rechazado",
    etapaActual: 5,
  };
  const activoOk = {
    cicloEstado: "activo",
    subestado: "en_proceso",
    etapaActual: 2,
  };

  it("rechazados solo ciclo activo (no cerrado ni cancelado)", () => {
    assert.equal(esAdminRechazadoOperativo(activoRechazado), true);
    assert.equal(esAdminRechazadoOperativo(canceladoConRechazo), false);
    assert.equal(
      esAdminRechazadoOperativo({
        cicloEstado: "cerrado",
        subestado: "rechazado",
        etapaActual: 5,
      }),
      false,
    );
    assert.equal(matchesAdminEstadoFilter(activoRechazado, "rechazados"), true);
    assert.equal(matchesAdminEstadoFilter(canceladoConRechazo, "rechazados"), false);
    assert.equal(matchesAdminEstadoFilter(cancelado, "rechazados"), false);
  });

  it("cancelados solo por ciclo", () => {
    assert.equal(esAdminCanceladoOperativo(cancelado), true);
    assert.equal(esAdminCanceladoOperativo(canceladoConRechazo), true);
    assert.equal(esAdminCanceladoOperativo(activoRechazado), false);
    assert.equal(matchesAdminEstadoFilter(cancelado, "cancelados"), true);
    assert.equal(matchesAdminEstadoFilter(activoRechazado, "cancelados"), false);
  });

  it("activos excluye rechazo y cancelado", () => {
    assert.equal(matchesAdminEstadoFilter(activoOk, "activos"), true);
    assert.equal(matchesAdminEstadoFilter(activoRechazado, "activos"), false);
    assert.equal(matchesAdminEstadoFilter(cancelado, "activos"), false);
  });

  it("RPC param: cancelados nativo (091)", () => {
    assert.equal(adminEstadoRpcParam("cancelados"), "cancelados");
    assert.equal(adminEstadoRpcParam("rechazados"), "rechazados");
    assert.equal(adminEstadoRpcParam("todos"), null);
    assert.equal(adminEstadoRpcParam(null), null);
  });
});
