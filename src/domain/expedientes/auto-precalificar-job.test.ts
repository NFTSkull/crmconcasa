import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { runAutoPrecalificarJob } from "./auto-precalificar-job";

type RpcCall = { fn: string; args: Record<string, unknown> };

function mockSupabase() {
  const rpcCalls: RpcCall[] = [];
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: null, data: null });
    },
    from() {
      return {
        insert() {
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { supabase, rpcCalls };
}

describe("runAutoPrecalificarJob", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("aprobado pasa campos Infonavit del scraper al RPC", async () => {
    const scraperBody = {
      califica: true,
      rfc: "XAXX010101000",
      registroPatronal: "A1234567890",
      empresa: "WOLONG ELECTRIC INDUSTRIAL MOTORS S DE RL DE CV",
      advertenciaInscripcion: null,
      datos: { saldoSubcuenta: "38,679.90" },
    };

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(scraperBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const { supabase, rpcCalls } = mockSupabase();
    const expedienteId = "11111111-1111-4111-8111-111111111111";

    const result = await runAutoPrecalificarJob({
      expedienteId,
      nss: "12345678901",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.deepEqual(result, { resultado: "aprobado", razon: null });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0]?.fn, "auto_upsert_editor_decision");
    assert.deepEqual(rpcCalls[0]?.args, {
      p_expediente_id: expedienteId,
      p_decision: "aprobado",
      p_monto_aprobado: 38679.9,
      p_motivo: null,
      p_rfc: "XAXX010101000",
      p_registro_patronal: "A1234567890",
      p_empresa: "WOLONG ELECTRIC INDUSTRIAL MOTORS S DE RL DE CV",
      p_advertencia_inscripcion: null,
    });
  });

  it("aprobado con crédito activo pasa advertenciaInscripcion y null en N.R.P./empresa", async () => {
    const scraperBody = {
      califica: true,
      rfc: "HEGG560427MVZRRL04",
      registroPatronal: null,
      empresa: null,
      advertenciaInscripcion: "Este trabajador tiene el crédito 1901000432",
      datos: { saldoSubcuenta: "50,000.00" },
    };

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(scraperBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const { supabase, rpcCalls } = mockSupabase();

    await runAutoPrecalificarJob({
      expedienteId: "22222222-2222-4222-8222-222222222222",
      nss: "98765432109",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.deepEqual(rpcCalls[0]?.args, {
      p_expediente_id: "22222222-2222-4222-8222-222222222222",
      p_decision: "aprobado",
      p_monto_aprobado: 50000,
      p_motivo: null,
      p_rfc: "HEGG560427MVZRRL04",
      p_registro_patronal: null,
      p_empresa: null,
      p_advertencia_inscripcion: "Este trabajador tiene el crédito 1901000432",
    });
  });

  it("no_cumple no envía parámetros Infonavit al RPC", async () => {
    const scraperBody = {
      califica: false,
      mensaje: "SIN RELACION LABORAL VIGENTE",
      rfc: "XAXX010101000",
      registroPatronal: "A1234567890",
      empresa: "NO DEBE PASAR",
    };

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(scraperBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const { supabase, rpcCalls } = mockSupabase();

    await runAutoPrecalificarJob({
      expedienteId: "33333333-3333-4333-8333-333333333333",
      nss: "11111111111",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.equal(rpcCalls.length, 1);
    assert.deepEqual(rpcCalls[0]?.args, {
      p_expediente_id: "33333333-3333-4333-8333-333333333333",
      p_decision: "no_cumple",
      p_monto_aprobado: null,
      p_motivo: "SIN RELACION LABORAL VIGENTE",
    });
    assert.equal("p_rfc" in (rpcCalls[0]?.args ?? {}), false);
  });

  it("compro_tu_casa usa montoCredito en el RPC", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          califica: true,
          rfc: "XAXX010101000",
          registroPatronal: null,
          empresa: null,
          advertenciaInscripcion: null,
          datos: {
            saldoSubcuenta: "189,051.68",
            montoCredito: "1,290,973.09",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const { supabase, rpcCalls } = mockSupabase();
    await runAutoPrecalificarJob({
      expedienteId: "44444444-4444-4444-8444-444444444444",
      nss: "43068952175",
      programa: "compro_tu_casa",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.equal(rpcCalls[0]?.args.p_monto_aprobado, 1290973.09);
  });
});
