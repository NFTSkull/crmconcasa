import assert from "node:assert/strict";
import { test } from "node:test";
import { mapAsesorUpdateMontoAprobadoRpcError } from "./asesor-update-monto-aprobado-rpc-error";

test("mapAsesorUpdateMontoAprobadoRpcError: monto inválido", () => {
  const err = mapAsesorUpdateMontoAprobadoRpcError({
    message: "asesor_update_monto_aprobado: monto_aprobado debe ser mayor a 0",
  });
  assert.match(err.message, /mayor a cero/i);
});

test("mapAsesorUpdateMontoAprobadoRpcError: ya enviado a Mesa", () => {
  const err = mapAsesorUpdateMontoAprobadoRpcError({
    message: "asesor_update_monto_aprobado: expediente ya enviado a Mesa",
  });
  assert.match(err.message, /ya fue enviado a Mesa/i);
});
