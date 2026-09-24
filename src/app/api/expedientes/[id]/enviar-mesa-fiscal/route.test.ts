import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyFiscalWorkerForMesa,
  isMissingFiscalGateRpcError,
  registerInvalidoOrRetry,
  FISCAL_WORKER_TIMEOUT_MS,
  maxDuration,
} from "./route";
import {
  FISCAL_MIN_BACKUP_ATTEMPT_MS,
  pickCapturedBackupRfc,
  planFiscalBackupAttempt,
} from "@/domain/validacion-fiscal/rfc";

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

describe("enviar-mesa-fiscal timeouts", () => {
  it("maxDuration 60 y presupuesto worker 50s", () => {
    assert.equal(maxDuration, 60);
    assert.equal(FISCAL_WORKER_TIMEOUT_MS, 50_000);
  });
});

describe("registerInvalidoOrRetry", () => {
  const base = {
    expedienteId: "11111111-1111-4111-8111-111111111111",
    fiscalRfc: "ABCD010101XXX",
    edcDocumentoId: "22222222-2222-4222-8222-222222222222",
    edcVersion: 1,
    code: "RFC_INVALIDO_SAT",
  };

  it("si el RPC falla → retry FISCAL_REGISTER_FAILED (nunca invalid / nunca Mesa)", async () => {
    const res = await registerInvalidoOrRetry({
      ...base,
      rpc: async () => ({ error: { code: "42501" } }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.status, "retry");
    assert.equal(body.code, "42501");
    assert.equal(body.submitted_to_mesa, false);
  });

  it("si el RPC falla sin code → FISCAL_REGISTER_FAILED", async () => {
    const res = await registerInvalidoOrRetry({
      ...base,
      rpc: async () => ({ error: {} }),
    });
    const body = await res.json();
    assert.equal(body.status, "retry");
    assert.equal(body.code, "FISCAL_REGISTER_FAILED");
    assert.equal(body.submitted_to_mesa, false);
  });

  it("si el RPC ok → invalid (no envía a Mesa)", async () => {
    const res = await registerInvalidoOrRetry({
      ...base,
      rpc: async () => ({ error: null }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.equal(body.status, "invalid");
    assert.equal(body.code, "RFC_INVALIDO_SAT");
    assert.equal(body.submitted_to_mesa, false);
  });
});

/**
 * Contratos del 2º intento (tryBackup en route.ts): planFiscalBackupAttempt
 * es lo que decide validate / INVALIDO / RM / sin cupo antes del fetch SAT.
 */
describe("enviar-mesa-fiscal tryBackup (2º intento)", () => {
  const CURP = "BADD900101HDFMLN03";
  const backupOk = pickCapturedBackupRfc({
    rfcInfonavit: "BADD9001019A1",
    rfcDatosGenerales: null,
    curpValidadaLocalmente: CURP,
  });

  it("PDF sin RFC + respaldo válido → validate (2º intento)", () => {
    assert.equal(backupOk.ok, true);
    const plan = planFiscalBackupAttempt({
      remainingMs: 40_000,
      backup: backupOk,
      afterPdfInvalid: false,
      hasPdfRfc: false,
    });
    assert.deepEqual(plan, { kind: "validate", timeoutMs: 40_000 });
  });

  it("PDF inválido en SAT + respaldo válido → validate (2º intento)", () => {
    const plan = planFiscalBackupAttempt({
      remainingMs: 25_000,
      backup: backupOk,
      afterPdfInvalid: true,
      hasPdfRfc: true,
    });
    assert.equal(plan.kind, "validate");
    if (plan.kind === "validate") assert.equal(plan.timeoutMs, 25_000);
  });

  it("PDF inválido en SAT + sin respaldo usable → register_invalid_pdf", () => {
    const noBackup = pickCapturedBackupRfc({
      rfcInfonavit: "CADD9102029A1",
      rfcDatosGenerales: null,
      curpValidadaLocalmente: CURP,
    });
    assert.equal(noBackup.ok, false);
    const plan = planFiscalBackupAttempt({
      remainingMs: 40_000,
      backup: noBackup,
      afterPdfInvalid: true,
      hasPdfRfc: true,
    });
    assert.deepEqual(plan, { kind: "register_invalid_pdf" });
  });

  it("respaldo sin tiempo (< MIN) → budget_exceeded", () => {
    const plan = planFiscalBackupAttempt({
      remainingMs: FISCAL_MIN_BACKUP_ATTEMPT_MS - 1,
      backup: backupOk,
      afterPdfInvalid: true,
      hasPdfRfc: true,
    });
    assert.deepEqual(plan, { kind: "budget_exceeded" });
  });

  it("PDF sin RFC + sin respaldo → revision_manual", () => {
    const noBackup = pickCapturedBackupRfc({
      rfcInfonavit: null,
      rfcDatosGenerales: null,
      curpValidadaLocalmente: CURP,
    });
    const plan = planFiscalBackupAttempt({
      remainingMs: 40_000,
      backup: noBackup,
      afterPdfInvalid: false,
      hasPdfRfc: false,
    });
    assert.equal(plan.kind, "revision_manual");
  });
});
