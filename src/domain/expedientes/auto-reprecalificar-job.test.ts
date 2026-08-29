import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { runAutoReprecalificarJob } from "./auto-reprecalificar-job";

type RpcCall = { fn: string; args: Record<string, unknown> };
type InsertCall = { table: string; row: Record<string, unknown> };

function mockSupabase() {
  const rpcCalls: RpcCall[] = [];
  const inserts: InsertCall[] = [];
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: null, data: null });
    },
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { supabase, rpcCalls, inserts };
}

describe("runAutoReprecalificarJob", () => {
  const originalFetch = globalThis.fetch;
  const intentoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("aprobado llama auto_resolver_reprecalificacion con Infonavit y registra intento", async () => {
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

    const { supabase, rpcCalls, inserts } = mockSupabase();
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
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0]?.table, "auto_reprecal_intentos");
    assert.deepEqual(inserts[0]?.row, {
      intento_id: intentoId,
      resultado: "aprobado",
      razon: null,
    });
  });

  it("no_cumple llama RPC sin campos Infonavit y registra intento", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          califica: false,
          mensaje: "SIN APORTACIONES",
          rfc: "NO",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const { supabase, rpcCalls, inserts } = mockSupabase();
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
    assert.deepEqual(inserts[0]?.row, {
      intento_id: intentoId,
      resultado: "no_cumple",
      razon: null,
    });
  });

  it("pending_error no llama RPC pero sí registra intento", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false, error: "timeout" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const { supabase, rpcCalls, inserts } = mockSupabase();
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
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0]?.row, {
      intento_id: intentoId,
      resultado: "pending_error",
      razon: "scraper_failed",
    });
  });
});
