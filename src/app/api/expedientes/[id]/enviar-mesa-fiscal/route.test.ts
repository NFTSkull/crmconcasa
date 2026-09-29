import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  classifyFiscalWorkerForMesa,
  isMissingFiscalGateRpcError,
  pickCorroboratedBackupRfc,
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
  it("Estado de Cuenta sigue siendo primera fuente y respaldo exige corroboración + SAT", () => {
    const src = readFileSync(
      new URL("./route.ts", import.meta.url),
      "utf8",
    );
    assert.match(src, /Estado de Cuenta sigue siendo la fuente primaria/);
    assert.match(src, /rfc_source: "estado_cuenta"/);
    assert.match(src, /RFC_ESTADO_CUENTA_NO_RESUELTO_/);
    assert.match(src, /fiscal_rfc_status/);
    assert.match(src, /cachedFiscalRfcUsable/);
    assert.match(src, /cachedFiscalRfcStillInDocument/);
    assert.match(src, /normalizedCachedFiscalRfc\.slice\(0, 10\) === currentCurpBase/);
    assert.match(src, /pickCorroboratedBackupRfc/);
    assert.match(src, /decision\.code === "RFC_INVALIDO_SAT"/);
    assert.match(src, /rfcSource: "respaldo_capturado"/);
    assert.match(src, /backupReason: "pdf_sat_invalid"/);
    assert.match(src, /gapUsesCorroboratedBackup/);
    assert.match(src, /pdfGapReason \?\? "pdf_estado_cuenta_unknown"/);
    assert.match(src, /cliente_constancia_situacion_fiscal/);
    assert.match(src, /fiscal_sat_constancia_uploaded/);
    assert.match(src, /tryAutofillRfcFromConstancia/);
    assert.match(src, /resolveConstanciaFiscalRfc/);
    assert.match(src, /server_sync_rfc_datos_generales_from_constancia/);
    assert.doesNotMatch(src, /server_registrar_validacion_fiscal_constancia/);
    assert.match(src, /NO bloqueamos el envío y NO llamamos al SAT externo/);
    const constanciaPos = src.indexOf("fiscal_sat_constancia_uploaded");
    const gatePos = src.indexOf("fiscal_sat_gate_applies_to_expediente", constanciaPos);
    assert.ok(constanciaPos >= 0, "debe revisar Constancia SAT primero");
    assert.ok(
      gatePos > constanciaPos,
      "con Constancia se debe resolver el bypass antes del gate SAT",
    );
    assert.match(src, /server_sync_rfc_datos_generales_from_sat/);
    const syncPos = src.indexOf("syncDatosGeneralesRfcFromSat({");
    const registerPos = src.indexOf("registerValidadoOrRetry({", syncPos);
    assert.ok(syncPos >= 0, "debe persistir RFC SAT en Datos Generales");
    assert.ok(
      registerPos > syncPos,
      "la persistencia de RFC debe ocurrir antes de registrar la huella VALIDADO",
    );
  });
});

describe("pickCorroboratedBackupRfc", () => {
  it("acepta I/1 de OCR solo si Infonavit y DG coinciden y la base CURP empata", () => {
    assert.deepEqual(
      pickCorroboratedBackupRfc({
        rfcInfonavit: "ABCD900805XYZ",
        rfcDatosGenerales: "ABCD900805XYZ",
        curpValidadaLocalmente: "ABCD900805HDFRRL09",
        pdfRfc: "ABCD9008051YZ",
      }),
      {
        ok: true,
        rfc: "ABCD900805XYZ",
        field: "rfc_infonavit",
      },
    );
  });

  it("acepta respaldo corroborado cuando el Estado de Cuenta no produjo RFC", () => {
    assert.deepEqual(
      pickCorroboratedBackupRfc({
        rfcInfonavit: "ABCD900805XYZ",
        rfcDatosGenerales: "ABCD900805XYZ",
        curpValidadaLocalmente: "ABCD900805HDFRRL09",
        pdfRfc: null,
      }),
      {
        ok: true,
        rfc: "ABCD900805XYZ",
        field: "rfc_infonavit",
      },
    );
  });

  it("histórico sin RFC Infonavit: permite DG full13 con misma fecha CURP para validar en SAT", () => {
    assert.deepEqual(
      pickCorroboratedBackupRfc({
        rfcInfonavit: null,
        rfcDatosGenerales: "NEIC730512PJ6",
        curpValidadaLocalmente: "IACN730512HSPBRR03",
        pdfRfc: null,
      }),
      {
        ok: true,
        rfc: "NEIC730512PJ6",
        field: "rfc_datos_generales",
      },
    );
  });

  it("no usa respaldo si Infonavit y DG no coinciden exactamente", () => {
    const result = pickCorroboratedBackupRfc({
      rfcInfonavit: "ABCD900805XYZ",
      rfcDatosGenerales: "ABCD900805QRS",
      curpValidadaLocalmente: "ABCD900805HDFRRL09",
      pdfRfc: "ABCD9008051YZ",
    });
    assert.deepEqual(result, {
      ok: false,
      reason: "captured_sources_disagree",
    });
  });

  it("no repite el mismo RFC que ya invalidó SAT", () => {
    const result = pickCorroboratedBackupRfc({
      rfcInfonavit: "ABCD900805XYZ",
      rfcDatosGenerales: "ABCD900805XYZ",
      curpValidadaLocalmente: "ABCD900805HDFRRL09",
      pdfRfc: "ABCD900805XYZ",
    });
    assert.deepEqual(result, { ok: false, reason: "same_as_pdf" });
  });

  it("no usa respaldo si la base10 no coincide con la CURP", () => {
    const result = pickCorroboratedBackupRfc({
      rfcInfonavit: "XXXX920303I40",
      rfcDatosGenerales: "XXXX920303I40",
      curpValidadaLocalmente: "ABCD900805HDFRRL09",
      pdfRfc: "ABCD9008051YZ",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected rejected backup");
    assert.equal(result.reason, "curp_base_mismatch");
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
