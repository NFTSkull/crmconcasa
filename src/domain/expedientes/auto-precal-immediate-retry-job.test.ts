import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { runAutoPrecalificarJob } from "./auto-precalificar-job";

type RpcCall = { fn: string; args: Record<string, unknown> };

function mockSupabase() {
  const rpcCalls: RpcCall[] = [];
  const inserts: Record<string, unknown>[] = [];
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "auto_precal_scraper_try_claim") {
        return Promise.resolve({ error: null, data: true });
      }
      if (fn === "auto_precal_scraper_release") {
        return Promise.resolve({ error: null, data: null });
      }
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: null, data: null });
    },
    from() {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { supabase, rpcCalls, inserts };
}

describe("auto-precal reintento inmediato transitorio", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("un login rechazado puede recuperarse en el segundo request sin esperar cron", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(
          JSON.stringify({ error: "Login fallido después de 3 intentos" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          califica: false,
          mensaje: "SIN RELACION LABORAL VIGENTE",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const { supabase, rpcCalls, inserts } = mockSupabase();
    const result = await runAutoPrecalificarJob({
      expedienteId: "11111111-1111-4111-8111-111111111111",
      nss: "12345678901",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      allowImmediateTransientRetry: true,
      supabase: supabase as never,
    });

    assert.deepEqual(result, { resultado: "no_cumple", razon: null });
    assert.equal(fetchCalls, 2);
    assert.equal(rpcCalls[0]?.fn, "auto_upsert_editor_decision");
    assert.deepEqual(
      inserts.map((row) => [row.resultado, row.razon]),
      [
        ["pending_error", "job_started"],
        ["no_cumple", null],
      ],
    );
  });

  it("un error fuera de allowlist conserva el fallback actual sin segundo request", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ error: "akamai_access_denied" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const { supabase, inserts } = mockSupabase();
    const result = await runAutoPrecalificarJob({
      expedienteId: "22222222-2222-4222-8222-222222222222",
      nss: "12345678901",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      allowImmediateTransientRetry: true,
      supabase: supabase as never,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: "scraper_failed",
    });
    assert.equal(fetchCalls, 1);
    assert.deepEqual(
      inserts.map((row) => [row.resultado, row.razon]),
      [
        ["pending_error", "job_started"],
        ["pending_error", "scraper_failed"],
      ],
    );
  });

  it("si el segundo request también falla, no hace un tercer intento", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({ error: "Login fallido después de 3 intentos" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const { supabase } = mockSupabase();
    const result = await runAutoPrecalificarJob({
      expedienteId: "33333333-3333-4333-8333-333333333333",
      nss: "12345678901",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      allowImmediateTransientRetry: true,
      supabase: supabase as never,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: "scraper_failed",
    });
    assert.equal(fetchCalls, 2);
  });

  it("sin opt-in, un fallo transitorio conserva un solo request para el cron", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({ error: "Login fallido después de 3 intentos" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const { supabase } = mockSupabase();
    const result = await runAutoPrecalificarJob({
      expedienteId: "44444444-4444-4444-8444-444444444444",
      nss: "12345678901",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: "scraper_failed",
    });
    assert.equal(fetchCalls, 1);
  });
});
