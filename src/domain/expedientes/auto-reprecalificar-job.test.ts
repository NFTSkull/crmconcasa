import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { runAutoReprecalificarJob } from "./auto-reprecalificar-job";

type RpcCall = { fn: string; args: Record<string, unknown> };

function mockSupabase() {
  const rpcCalls: RpcCall[] = [];
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: null, data: null });
    },
  };
  return { supabase, rpcCalls };
}

describe("runAutoReprecalificarJob", () => {
  const originalFetch = globalThis.fetch;
  const intentoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("aprobado llama auto_resolver_reprecalificacion con Infonavit", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          califica: true,
          rfc: "XAXX010101000",
          registroPatronal: "A1234567890",
          empresa: "ACME SA",
          advertenciaInscripcion: null,
          datos: { saldoSubcuenta: "10,000.00" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const { supabase, rpcCalls } = mockSupabase();
    const result = await runAutoReprecalificarJob({
      intentoId,
      nss: "12345678901",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.deepEqual(result, { resultado: "aprobado", razon: null });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0]?.fn, "auto_resolver_reprecalificacion");
    assert.deepEqual(rpcCalls[0]?.args, {
      p_intento_id: intentoId,
      p_decision: "aprobado",
      p_monto_aprobado: 10000,
      p_motivo: null,
      p_rfc: "XAXX010101000",
      p_registro_patronal: "A1234567890",
      p_empresa: "ACME SA",
      p_advertencia_inscripcion: null,
    });
  });

  it("no_cumple llama RPC sin campos Infonavit", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          califica: false,
          mensaje: "SIN APORTACIONES",
          rfc: "NO",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const { supabase, rpcCalls } = mockSupabase();
    await runAutoReprecalificarJob({
      intentoId,
      nss: "12345678901",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.equal(rpcCalls[0]?.fn, "auto_resolver_reprecalificacion");
    assert.deepEqual(rpcCalls[0]?.args, {
      p_intento_id: intentoId,
      p_decision: "no_cumple",
      p_monto_aprobado: null,
      p_motivo: "SIN APORTACIONES",
    });
  });

  it("pending_error no llama RPC", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false, error: "timeout" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const { supabase, rpcCalls } = mockSupabase();
    const result = await runAutoReprecalificarJob({
      intentoId,
      nss: "12345678901",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: "scraper_failed",
    });
    assert.equal(rpcCalls.length, 0);
  });
});
