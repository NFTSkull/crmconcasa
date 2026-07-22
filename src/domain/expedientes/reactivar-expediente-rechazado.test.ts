import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASESOR_REACTIVAR_RECHAZO_CTA,
  esExpedienteRechazadoOperativoActivo,
  getReactivacionErrorCode,
  mapReactivacionRpcError,
  reactivarExpedienteResponseSchema,
  subestadoCanonicoTrasReactivacion,
} from "./reactivar-expediente-rechazado";

test("subestadoCanonicoTrasReactivacion espeja mesa_mover", () => {
  assert.equal(subestadoCanonicoTrasReactivacion(1), "en_validacion_mesa");
  for (let etapa = 2; etapa <= 12; etapa += 1) {
    assert.equal(subestadoCanonicoTrasReactivacion(etapa), "en_proceso");
  }
});

test("esExpedienteRechazadoOperativoActivo solo rechazo recuperable", () => {
  assert.equal(
    esExpedienteRechazadoOperativoActivo({
      submittedToMesa: true,
      cicloEstado: "activo",
      subestado: "rechazado",
    }),
    true,
  );
  assert.equal(
    esExpedienteRechazadoOperativoActivo({
      submittedToMesa: true,
      cicloEstado: "cancelado",
      subestado: "rechazado",
    }),
    false,
  );
  assert.equal(
    esExpedienteRechazadoOperativoActivo({
      submittedToMesa: true,
      cicloEstado: "activo",
      subestado: "en_proceso",
    }),
    false,
  );
});

test("reactivarExpedienteResponseSchema valida contrato RPC", () => {
  const parsed = reactivarExpedienteResponseSchema.parse({
    ok: true,
    expediente_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    reactivacion_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    rechazo_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    etapa: 7,
    subestado_anterior: "rechazado",
    subestado: "en_proceso",
  });
  assert.equal(parsed.subestado, "en_proceso");
});

test("mapReactivacionRpcError usa códigos estables", () => {
  assert.equal(
    getReactivacionErrorCode({ message: "REACTIVATION_ALREADY_DONE: x" }),
    "REACTIVATION_ALREADY_DONE",
  );
  assert.match(
    mapReactivacionRpcError({ message: "REACTIVATION_UNAUTHORIZED: x" })
      .message,
    /permiso/i,
  );
  assert.equal(ASESOR_REACTIVAR_RECHAZO_CTA, "Corregir y reenviar a Mesa");
});
