import test from "node:test";
import assert from "node:assert/strict";
import { canUserAccessExpediente, filterExpedientesByRole } from "./mesaControlAccess";
import type { ExpedienteMock } from "@/domain/expedientes/mock.repo";

function exp(id: string, basePatch: Partial<ExpedienteMock["base"]> = {}): ExpedienteMock {
  return {
    id,
    base: {
      programa: "Mejoravit",
      nss: "",
      cliente_nombre: "X",
      telefono_cliente: "",
      direccion_opcional: "",
      asesorId: "a@test",
      createdAt: "2026-01-01T00:00:00.000Z",
      origenMesa: null,
      ...basePatch,
    },
    editorDecision: {
      decision: "pendiente",
      monto_aprobado: null,
      notas_revision: "",
    },
    operativo: {
      etapaActual: 2,
      subestado: "en_validacion_mesa",
      motivoRechazo: null,
      comentarioRechazo: null,
      fechaCita: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      submittedToMesa: true,
      fechaEnvioMesa: null,
      cicloEstado: null,
    },
  };
}

test("canUserAccessExpediente: admin y mesa_control legacy ven todo", () => {
  const e = exp("1", { origenMesa: "externo" });
  assert.equal(canUserAccessExpediente({ mockRole: "mesa_control_admin" }, e), true);
  assert.equal(canUserAccessExpediente({ mockRole: "mesa_control" }, e), true);
});

test("canUserAccessExpediente: interno solo ve interno", () => {
  const int = exp("1", { origenMesa: "interno" });
  const ext = exp("2", { origenMesa: "externo" });
  assert.equal(canUserAccessExpediente({ mockRole: "mesa_control_interno" }, int), true);
  assert.equal(canUserAccessExpediente({ mockRole: "mesa_control_interno" }, ext), false);
});

test("canUserAccessExpediente: externo solo ve externo", () => {
  const int = exp("1", { origenMesa: "interno" });
  const ext = exp("2", { origenMesa: "externo" });
  assert.equal(canUserAccessExpediente({ mockRole: "mesa_control_externo" }, int), false);
  assert.equal(canUserAccessExpediente({ mockRole: "mesa_control_externo" }, ext), true);
});

test("canUserAccessExpediente: origen null cae a interno", () => {
  const e = exp("1", { origenMesa: null });
  assert.equal(canUserAccessExpediente({ mockRole: "mesa_control_interno" }, e), true);
  assert.equal(canUserAccessExpediente({ mockRole: "mesa_control_externo" }, e), false);
});

test("filterExpedientesByRole delega en canUserAccessExpediente", () => {
  const list = [exp("1", { origenMesa: "interno" }), exp("2", { origenMesa: "externo" })];
  const out = filterExpedientesByRole({ mockRole: "mesa_control_interno" }, list);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "1");
});
