import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  classifyFiscalWorkerForMesa,
  isMissingFiscalGateRpcError,
  registerInvalidoOrRetry,
  FISCAL_WORKER_TIMEOUT_MS,
  maxDuration,
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

describe("enviar-mesa-fiscal timeouts", () => {
  it("maxDuration 60 y presupuesto worker 50s", () => {
    assert.equal(maxDuration, 60);
    assert.equal(FISCAL_WORKER_TIMEOUT_MS, 50_000);
  });
});

describe("enviar-mesa-fiscal fuente RFC", () => {
  it("solo envía al SAT el RFC resuelto desde Estado de Cuenta", () => {
    const src = readFileSync(
      new URL("./route.ts", import.meta.url),
      "utf8",
    );
    assert.match(src, /RFC del Estado de Cuenta vigente: única fuente enviada al SAT/);
    assert.match(src, /rfc_source: "estado_cuenta"/);
    assert.match(src, /RFC_ESTADO_CUENTA_NO_RESUELTO_/);
    assert.match(src, /fiscal_rfc_status/);
    assert.match(src, /cachedFiscalRfcUsable/);
    assert.match(src, /cachedFiscalRfcStillInDocument/);
    assert.match(src, /normalizedCachedFiscalRfc\.slice\(0, 10\) === currentCurpBase/);
    assert.doesNotMatch(src, /pickCapturedBackupRfc/);
    assert.doesNotMatch(src, /const tryBackup/);
    assert.doesNotMatch(src, /rfcSource: "respaldo_capturado"/);
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


describe("extractEstadoCuentaOcrLive", () => {
  it("usa el OCR autenticado del mismo Estado de Cuenta", async () => {
    const originalFetch = globalThis.fetch;
    let seenAuth = "";
    let seenType = "";
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenAuth = String(new Headers(init?.headers).get("authorization") ?? "");
      const form = init?.body as FormData;
      seenType = String(form.get("document_type") ?? "");
      return new Response(
        JSON.stringify({
          ok: true,
          text: "TITULAR PRUEBA RFC BADD9001019A1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const result = await extractEstadoCuentaOcrLive({
        pdf: new Blob(["pdf"], { type: "application/pdf" }),
        token: "jwt-test",
        timeoutMs: 5_000,
      });
      assert.equal(result.ok, true);
      if (!result.ok) throw new Error("expected OCR success");
      assert.match(result.text, /BADD9001019A1/);
      assert.equal(seenAuth, "Bearer jwt-test");
      assert.equal(seenType, "cliente_estado_cuenta");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("no inicia OCR si ya no cabe dentro del presupuesto", async () => {
    const result = await extractEstadoCuentaOcrLive({
      pdf: new Blob(["pdf"], { type: "application/pdf" }),
      token: "jwt-test",
      timeoutMs: 999,
    });
    assert.deepEqual(result, {
      ok: false,
      code: "ESTADO_CUENTA_OCR_BUDGET_EXCEEDED",
    });
  });

  it("falla cerrado ante rechazo de autenticación OCR", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      const result = await extractEstadoCuentaOcrLive({
        pdf: new Blob(["pdf"], { type: "application/pdf" }),
        token: "jwt-test",
        timeoutMs: 5_000,
      });
      assert.deepEqual(result, {
        ok: false,
        code: "ESTADO_CUENTA_OCR_AUTH_FAILED",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
