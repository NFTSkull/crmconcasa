import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyFiscalWorkerForMesa } from "./route";

describe("enviar-mesa-fiscal worker decision", () => {
  it("PASS solo cuando RFC y CURP son valid", () => {
    assert.deepEqual(
      classifyFiscalWorkerForMesa({
        ok: true,
        semantic: "pass",
        rfc: { status: "valid" },
        curp: { status: "valid" },
      }),
      { kind: "pass" },
    );
  });

  it("RFC inválido certificado bloquea Mesa", () => {
    assert.deepEqual(
      classifyFiscalWorkerForMesa({
        ok: false,
        semantic: "invalid",
        rfc: { status: "invalid" },
        curp: { status: "not_run" },
      }),
      { kind: "invalid", code: "RFC_INVALIDO_SAT" },
    );
  });

  it("CURP inválida certificada bloquea Mesa", () => {
    assert.deepEqual(
      classifyFiscalWorkerForMesa({
        ok: false,
        semantic: "invalid",
        rfc: { status: "valid" },
        curp: { status: "invalid" },
      }),
      { kind: "invalid", code: "CURP_INVALIDA_SAT" },
    );
  });

  it("unknown/retry nunca autoriza Mesa", () => {
    assert.deepEqual(
      classifyFiscalWorkerForMesa({
        ok: false,
        semantic: "retry",
        code: "TECHNICAL_FAILURE",
        rfc: { status: "unknown" },
        curp: { status: "not_run" },
      }),
      { kind: "retry", code: "TECHNICAL_FAILURE" },
    );
  });

  it("semantic pass incompleto falla cerrado", () => {
    assert.deepEqual(
      classifyFiscalWorkerForMesa({
        ok: true,
        semantic: "pass",
        rfc: { status: "valid" },
        curp: { status: "unknown" },
      }),
      { kind: "retry", code: "SAT_RESULTADO_NO_CONCLUYENTE" },
    );
  });
});
