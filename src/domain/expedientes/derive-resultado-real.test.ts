import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveResultadoRealExpediente,
  type ExpedienteMock,
} from "./mock.repo";

function stub(partial: {
  submittedToMesa?: boolean;
  subestado?: ExpedienteMock["operativo"]["subestado"];
  cicloEstado?: ExpedienteMock["operativo"]["cicloEstado"];
  decision?: ExpedienteMock["editorDecision"]["decision"];
}): ExpedienteMock {
  return {
    id: "e1",
    base: {
      programa: "mejoravit",
      nss: "12345678901",
      cliente_nombre: "Cliente",
      telefono_cliente: "8110000000",
      direccion_opcional: "",
      asesorId: "a1",
      createdAt: "2026-07-01T00:00:00.000Z",
      origenMesa: "interno",
    },
    editorDecision: {
      decision: partial.decision ?? "aprobado",
      monto_aprobado: 30000,
      notas_revision: "",
    },
    operativo: {
      submittedToMesa: partial.submittedToMesa ?? true,
      fechaEnvioMesa: "2026-07-02T00:00:00.000Z",
      etapaActual: 5,
      subestado: partial.subestado ?? "en_proceso",
      cicloEstado: partial.cicloEstado ?? "activo",
      motivoRechazo: null,
      comentarioRechazo: null,
      fechaCita: null,
      updatedAt: "2026-07-02T00:00:00.000Z",
    },
  } as ExpedienteMock;
}

describe("deriveResultadoRealExpediente — P094", () => {
  it("cancelado tiene prioridad sobre rechazo y en_tramite", () => {
    assert.equal(
      deriveResultadoRealExpediente(
        stub({ subestado: "rechazado", cicloEstado: "cancelado" }),
      ),
      "cancelado",
    );
    assert.equal(
      deriveResultadoRealExpediente(
        stub({ subestado: "en_proceso", cicloEstado: "cancelado" }),
      ),
      "cancelado",
    );
  });

  it("rechazado_mesa solo con ciclo activo (recuperable)", () => {
    assert.equal(
      deriveResultadoRealExpediente(
        stub({ subestado: "rechazado", cicloEstado: "activo" }),
      ),
      "rechazado_mesa",
    );
    assert.equal(
      deriveResultadoRealExpediente(
        stub({ subestado: "rechazado", cicloEstado: null }),
      ),
      "rechazado_mesa",
    );
  });

  it("enviado sin rechazo recuperable => en_tramite", () => {
    assert.equal(
      deriveResultadoRealExpediente(
        stub({ subestado: "en_proceso", cicloEstado: "activo" }),
      ),
      "en_tramite",
    );
  });

  it("sin envío a mesa => decisión editor", () => {
    assert.equal(
      deriveResultadoRealExpediente(
        stub({
          submittedToMesa: false,
          subestado: "pendiente",
          decision: "no_cumple",
        }),
      ),
      "no_cumple_editor",
    );
  });
});
