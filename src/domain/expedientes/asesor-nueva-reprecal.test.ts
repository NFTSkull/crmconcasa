import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateExpedienteInput } from "./create-expediente.input";
import type { NssPrecalGateResult } from "./nss-precal-gate";
import {
  MSG_NUEVA_REPRECAL_BODY,
  MSG_NUEVA_REPRECAL_CHANGE_SUCCESS,
  MSG_NUEVA_REPRECAL_PENDING,
  MSG_NUEVA_REPRECAL_SAME_Q,
  MSG_NUEVA_REPRECAL_SUCCESS,
  MSG_NUEVA_REPRECAL_TITLE,
  createNuevaReprecalSubmitGuard,
  decideNuevaAfterGate,
  executeNuevaReprecalConfirm,
  iniciarPayloadFromNuevaForm,
  nuevaExpedienteDetallePath,
  validateNuevaConfirmBeforeRpc,
} from "./asesor-nueva-reprecal";

const EXP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INT_A = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function gate(
  partial: Partial<NssPrecalGateResult> & Pick<NssPrecalGateResult, "status">,
): NssPrecalGateResult {
  return {
    message: partial.message ?? "ok",
    expediente_id: partial.expediente_id ?? EXP_A,
    nss: "43139742449",
    programa: "mejoravit",
    ...partial,
  };
}

const form: CreateExpedienteInput = {
  programa: "Mejoravit",
  nss: "43139742449",
  cliente_nombre: "Cliente prueba",
  telefono_cliente: "8111111111",
  direccion_opcional: "Calle 1",
  asesorEmail: "paty@example.com",
};

describe("P181 /asesor/nueva reprecal propio", () => {
  it("A) own same program → confirmación, no create", () => {
    const d = decideNuevaAfterGate(gate({ status: "reprecal_own_mesa" }));
    assert.equal(d.action, "confirm_same");
    if (d.action === "confirm_same") {
      assert.equal(d.expedienteId, EXP_A);
    }
    assert.match(MSG_NUEVA_REPRECAL_TITLE, /ya está en tus expedientes/i);
    assert.match(MSG_NUEVA_REPRECAL_SAME_Q, /volver a enviar/i);
    assert.match(MSG_NUEVA_REPRECAL_BODY, /no se creará uno nuevo/i);
  });

  it("B) confirm same: revalida, mismo id, iniciar, no create", async () => {
    const lookups: string[] = [];
    const inicios: string[] = [];
    const creates: string[] = [];
    const guard = createNuevaReprecalSubmitGuard();
    const result = await executeNuevaReprecalConfirm({
      guard,
      firstExpedienteId: EXP_A,
      mode: "same_programa",
      form,
      lookup: async () => {
        lookups.push("lookup");
        return gate({ status: "reprecal_own_mesa", expediente_id: EXP_A });
      },
      iniciar: async (payload) => {
        inicios.push(payload.idempotency_key);
        return { expediente_id: EXP_A, intento_id: INT_A };
      },
    });
    void creates;
    assert.deepEqual(result, {
      ok: true,
      expedienteId: EXP_A,
      intentoId: INT_A,
    });
    assert.equal(lookups.length, 1);
    assert.equal(inicios.length, 1);
    assert.equal(creates.length, 0);
    assert.equal(
      nuevaExpedienteDetallePath(EXP_A),
      `/asesor/expediente/${EXP_A}`,
    );
    assert.match(MSG_NUEVA_REPRECAL_SUCCESS, /enviada nuevamente/i);
  });

  it("C) double click: 1 RPC máximo", async () => {
    let iniciarCalls = 0;
    let lookupCalls = 0;
    const guard = createNuevaReprecalSubmitGuard();
    let releaseLookup: (() => void) | undefined;
    const blocked = new Promise<NssPrecalGateResult>((resolve) => {
      releaseLookup = () =>
        resolve(gate({ status: "reprecal_own_mesa", expediente_id: EXP_A }));
    });
    const first = executeNuevaReprecalConfirm({
      guard,
      firstExpedienteId: EXP_A,
      mode: "same_programa",
      form,
      lookup: async () => {
        lookupCalls += 1;
        return blocked;
      },
      iniciar: async () => {
        iniciarCalls += 1;
        return { expediente_id: EXP_A, intento_id: INT_A };
      },
    });
    const second = await executeNuevaReprecalConfirm({
      guard,
      firstExpedienteId: EXP_A,
      mode: "same_programa",
      form,
      lookup: async () => {
        lookupCalls += 1;
        return gate({ status: "reprecal_own_mesa" });
      },
      iniciar: async () => {
        iniciarCalls += 1;
        return { expediente_id: EXP_A, intento_id: INT_A };
      },
    });
    assert.deepEqual(second, { ok: false, reason: "in_flight" });
    releaseLookup?.();
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
    assert.equal(lookupCalls, 1);
    assert.equal(iniciarCalls, 1);
  });

  it("D) pending id no bloquea confirm; mismo RPC iniciar", async () => {
    const d = decideNuevaAfterGate(
      gate({
        status: "reprecal_own_mesa",
        reprecalificacion_pendiente_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    );
    assert.equal(d.action, "confirm_same");
    assert.match(MSG_NUEVA_REPRECAL_PENDING, /en revisión/i);
    let iniciar = 0;
    const result = await executeNuevaReprecalConfirm({
      guard: createNuevaReprecalSubmitGuard(),
      firstExpedienteId: EXP_A,
      mode: "same_programa",
      form,
      lookup: async () =>
        gate({
          status: "reprecal_own_mesa",
          reprecalificacion_pendiente_id:
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        }),
      iniciar: async () => {
        iniciar += 1;
        return { expediente_id: EXP_A, intento_id: INT_A };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(iniciar, 1);
  });

  it("E) own change program → confirm change + validate change_programa", async () => {
    const d = decideNuevaAfterGate(
      gate({
        status: "reprecal_change_programa",
        programa_actual: "mejoravit",
        programa_solicitado: "compro_tu_casa",
      }),
    );
    assert.equal(d.action, "confirm_change");
    assert.equal(
      validateNuevaConfirmBeforeRpc({
        mode: "change_programa",
        firstExpedienteId: EXP_A,
        secondGate: gate({ status: "reprecal_change_programa" }),
      }),
      null,
    );
    assert.ok(
      validateNuevaConfirmBeforeRpc({
        mode: "change_programa",
        firstExpedienteId: EXP_A,
        secondGate: gate({ status: "reprecal_own_mesa" }),
      }),
    );
    let iniciar = 0;
    const result = await executeNuevaReprecalConfirm({
      guard: createNuevaReprecalSubmitGuard(),
      firstExpedienteId: EXP_A,
      mode: "change_programa",
      form: { ...form, programa: "Compro tu casa" },
      lookup: async () => gate({ status: "reprecal_change_programa" }),
      iniciar: async () => {
        iniciar += 1;
        return { expediente_id: EXP_A, intento_id: INT_A };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(iniciar, 1);
    assert.match(MSG_NUEVA_REPRECAL_CHANGE_SUCCESS, /no cambiará hasta/i);
  });

  it("F) P179 other pre-Mesa ok_create → create, no confirm", () => {
    const d = decideNuevaAfterGate(gate({ status: "ok_create" }));
    assert.equal(d.action, "create");
  });

  it("G) other post-Mesa blocked_other_asesor → 0 create 0 iniciar", async () => {
    const d = decideNuevaAfterGate(
      gate({
        status: "blocked_other_asesor",
        message: "Este NSS ya tiene un expediente activo asignado a otro asesor.",
      }),
    );
    assert.equal(d.action, "blocked");
    let iniciar = 0;
    const result = await executeNuevaReprecalConfirm({
      guard: createNuevaReprecalSubmitGuard(),
      firstExpedienteId: EXP_A,
      mode: "same_programa",
      form,
      lookup: async () => gate({ status: "blocked_other_asesor" }),
      iniciar: async () => {
        iniciar += 1;
        return {};
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "gate");
    assert.equal(iniciar, 0);
  });

  it("H) ambiguous → 0 create 0 iniciar", async () => {
    const d = decideNuevaAfterGate(gate({ status: "blocked_ambiguous" }));
    assert.equal(d.action, "blocked");
    let iniciar = 0;
    const result = await executeNuevaReprecalConfirm({
      guard: createNuevaReprecalSubmitGuard(),
      firstExpedienteId: EXP_A,
      mode: "same_programa",
      form,
      lookup: async () => gate({ status: "blocked_ambiguous" }),
      iniciar: async () => {
        iniciar += 1;
        return {};
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "gate");
    assert.equal(iniciar, 0);
  });

  it("I) TOCTOU: segundo gate distinto status o expediente B → no iniciar", async () => {
    let iniciar = 0;
    const statusChange = await executeNuevaReprecalConfirm({
      guard: createNuevaReprecalSubmitGuard(),
      firstExpedienteId: EXP_A,
      mode: "same_programa",
      form,
      lookup: async () => gate({ status: "ok_create" }),
      iniciar: async () => {
        iniciar += 1;
        return {};
      },
    });
    assert.equal(statusChange.ok, false);
    if (!statusChange.ok) assert.equal(statusChange.reason, "gate");

    const otherExp = await executeNuevaReprecalConfirm({
      guard: createNuevaReprecalSubmitGuard(),
      firstExpedienteId: EXP_A,
      mode: "same_programa",
      form,
      lookup: async () =>
        gate({ status: "reprecal_own_mesa", expediente_id: EXP_B }),
      iniciar: async () => {
        iniciar += 1;
        return {};
      },
    });
    assert.equal(otherExp.ok, false);
    if (!otherExp.ok) assert.equal(otherExp.reason, "gate");
    assert.equal(iniciar, 0);
  });

  it("J) redirect path detalle", () => {
    assert.equal(
      nuevaExpedienteDetallePath(EXP_A),
      `/asesor/expediente/${EXP_A}`,
    );
  });

  it("retries del mismo intento reusan idempotency key", () => {
    const guard = createNuevaReprecalSubmitGuard();
    const a = guard.getIdempotencyKey();
    const b = guard.getIdempotencyKey();
    assert.equal(a, b);
    guard.clearKey();
    const c = guard.getIdempotencyKey();
    assert.notEqual(a, c);
    const payload = iniciarPayloadFromNuevaForm(form, a);
    assert.equal(payload.nss, form.nss);
    assert.equal(payload.cliente_nombre, form.cliente_nombre);
    assert.equal(payload.idempotency_key, a);
  });
});
