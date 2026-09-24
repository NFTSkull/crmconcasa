import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyFiscalWorkerForMesa,
  isMissingFiscalGateRpcError,
} from "./route";

describe("enviar-mesa-fiscal missing mig 228 fail-open", () => {
  it("42883 / PGRST202 → fail-open (RPC gate ausente)", () => {
    assert.equal(
      isMissingFiscalGateRpcError({
        code: "42883",
        message: 'function public.fiscal_sat_gate_applies_to_expediente(uuid) does not exist',
      }),
      true,
    );
    assert.equal(
      isMissingFiscalGateRpcError({
        code: "PGRST202",
        message: "Could not find the function public.fiscal_sat_gate_applies_to_expediente",
      }),
      true,
    );
  });

  it("otros errores del gate → fail-closed", () => {
    assert.equal(
      isMissingFiscalGateRpcError({
        code: "42501",
        message: "permission denied for function fiscal_sat_gate_applies_to_expediente",
      }),
      false,
    );
    assert.equal(
      isMissingFiscalGateRpcError({
        code: "57014",
        message: "canceling statement due to statement timeout",
      }),
      false,
    );
    assert.equal(
      isMissingFiscalGateRpcError({
        code: "PGRST301",
        message: "JWT expired",
      }),
      false,
    );
    assert.equal(isMissingFiscalGateRpcError(null), false);
    assert.equal(isMissingFiscalGateRpcError(undefined), false);
  });
});

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
