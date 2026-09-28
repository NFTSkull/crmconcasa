import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { AUTO_PRECAL_SCRAPER_BUSY_REASON } from "./auto-precal-scraper-lease";
import { runAutoPrecalificarJob } from "./auto-precalificar-job";

type RpcCall = { fn: string; args: Record<string, unknown> };

function mockSupabase() {
  const rpcCalls: RpcCall[] = [];
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

  it("aprobado con nombre llama auto_fill_nombre_infonavit tras upsert", async () => {
    const scraperBody = {
      califica: true,
      rfc: "XAXX010101000",
      nombre: "MARCOS MARTINEZ ANA CECILIA",
      registroPatronal: "A1234567890",
      empresa: "ACME SA",
      datos: { saldoSubcuenta: "10,000.00" },
    };

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(scraperBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const { supabase, rpcCalls } = mockSupabase();
    const expedienteId = "44444444-4444-4444-8444-444444444444";

    const result = await runAutoPrecalificarJob({
      expedienteId,
      nss: "12345678901",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.deepEqual(result, { resultado: "aprobado", razon: null });
    assert.equal(rpcCalls.length, 2);
    assert.equal(rpcCalls[0]?.fn, "auto_upsert_editor_decision");
    assert.equal(rpcCalls[1]?.fn, "auto_fill_nombre_infonavit");
    assert.deepEqual(rpcCalls[1]?.args, {
      p_expediente_id: expedienteId,
      p_nombre_completo: "MARCOS MARTINEZ ANA CECILIA",
    });
  });

  it("normaliza # a Ñ antes del RPC de nombre", async () => {
    const scraperBody = {
      califica: true,
      nombre: "MORENO PI#A ALAN ANTOVELI",
      datos: { saldoSubcuenta: "10,000.00" },
    };

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(scraperBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const { supabase, rpcCalls } = mockSupabase();
    const expedienteId = "44444444-4444-4444-8444-444444444445";

    await runAutoPrecalificarJob({
      expedienteId,
      nss: "09109117045",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.equal(rpcCalls[1]?.fn, "auto_fill_nombre_infonavit");
    assert.equal(
      rpcCalls[1]?.args.p_nombre_completo,
      "MORENO PIÑA ALAN ANTOVELI",
    );
  });

  it("fallo de auto_fill_nombre_infonavit no tumba el aprobado", async () => {
    const scraperBody = {
      califica: true,
      nombre: "SOLO NOMBRE",
      datos: { saldoSubcuenta: "1,000.00" },
    };

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(scraperBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;

    const rpcCalls: RpcCall[] = [];
    const supabase = {
      rpc(fn: string, args: Record<string, unknown>) {
        if (fn === "auto_precal_scraper_try_claim") {
          return Promise.resolve({ error: null, data: true });
        }
        if (fn === "auto_precal_scraper_release") {
          return Promise.resolve({ error: null, data: null });
        }
        rpcCalls.push({ fn, args });
        if (fn === "auto_fill_nombre_infonavit") {
          return Promise.resolve({
            error: { message: "sin_capability" },
            data: null,
          });
        }
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

    const result = await runAutoPrecalificarJob({
      expedienteId: "55555555-5555-4555-8555-555555555555",
      nss: "12345678901",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.deepEqual(result, { resultado: "aprobado", razon: null });
    assert.equal(rpcCalls[1]?.fn, "auto_fill_nombre_infonavit");
  });

  it("scraper_busy: no llama scraper ni escribe intento", async () => {
    let fetchCalls = 0;
    const inserts: Record<string, unknown>[] = [];
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const supabase = {
      rpc(fn: string) {
        if (fn === "auto_precal_scraper_try_claim") {
          return Promise.resolve({ error: null, data: false });
        }
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

    const result = await runAutoPrecalificarJob({
      expedienteId: "77777777-7777-4777-8777-777777777777",
      nss: "12345678901",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: AUTO_PRECAL_SCRAPER_BUSY_REASON,
    });
    assert.equal(fetchCalls, 0);
    assert.deepEqual(inserts, []);
  });

  it("claim_failed: no llama scraper si el lease job_started falla", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const supabase = {
      rpc(fn: string) {
        if (fn === "auto_precal_scraper_try_claim") {
          return Promise.resolve({ error: null, data: true });
        }
        return Promise.resolve({ error: null, data: null });
      },
      from() {
        return {
          insert() {
            return Promise.resolve({ error: { message: "insert denied" } });
          },
        };
      },
    };

    const result = await runAutoPrecalificarJob({
      expedienteId: "66666666-6666-4666-8666-666666666666",
      nss: "12345678901",
      programa: "mejoravit",
      scraperUrl: "https://scraper.test",
      scraperSecret: "secret",
      supabase: supabase as never,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: "claim_failed",
    });
    assert.equal(fetchCalls, 0);
  });
});

describe("runAutoPrecalificarJob espera corta del lease global", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function aprobadoFetch() {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ califica: true, datos: { saldoSubcuenta: "10,000.00" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    return () => calls;
  }

  function leaseHarness(claimResults: (boolean | "rpc_error")[]) {
    let t = 0;
    let i = 0;
    const sleeps: number[] = [];
    const claimTokens: string[] = [];
    const releaseTokens: string[] = [];
    const inserts: Record<string, unknown>[] = [];
    const rpcCalls: RpcCall[] = [];
    const supabase = {
      rpc(fn: string, args: Record<string, unknown>) {
        if (fn === "auto_precal_scraper_try_claim") {
          claimTokens.push(String(args.p_owner_token));
          const next = claimResults[Math.min(i, claimResults.length - 1)];
          i += 1;
          if (next === "rpc_error") {
            return Promise.resolve({ error: { message: "boom" }, data: null });
          }
          return Promise.resolve({ error: null, data: next });
        }
        if (fn === "auto_precal_scraper_release") {
          releaseTokens.push(String(args.p_owner_token));
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
    const deps = {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    };
    return { supabase, deps, sleeps, claimTokens, releaseTokens, inserts, rpcCalls };
  }

  const baseInput = {
    expedienteId: "88888888-8888-4888-8888-888888888888",
    nss: "12345678901",
    programa: "mejoravit",
    scraperUrl: "https://scraper.test",
    scraperSecret: "secret",
  };

  it("lease libre de inmediato: un claim, sin sleep, scraper una vez", async () => {
    const fetchCalls = aprobadoFetch();
    const h = leaseHarness([true]);

    const result = await runAutoPrecalificarJob({
      ...baseInput,
      supabase: h.supabase as never,
      scraperBusyWaitMs: 10_000,
      scraperLeaseWaitDeps: h.deps,
    });

    assert.deepEqual(result, { resultado: "aprobado", razon: null });
    assert.equal(h.claimTokens.length, 1);
    assert.deepEqual(h.sleeps, []);
    assert.equal(fetchCalls(), 1);
    assert.deepEqual(h.releaseTokens, [h.claimTokens[0]]);
    assert.deepEqual(
      h.inserts.map((r) => [r.resultado, r.razon]),
      [
        ["pending_error", "job_started"],
        ["aprobado", null],
      ],
    );
    assert.equal(h.rpcCalls[0]?.fn, "auto_upsert_editor_decision");
  });

  it("ocupado, ocupado, libre: espera con sleep, adquiere y procesa normal", async () => {
    const fetchCalls = aprobadoFetch();
    const h = leaseHarness([false, false, true]);

    const result = await runAutoPrecalificarJob({
      ...baseInput,
      supabase: h.supabase as never,
      scraperBusyWaitMs: 10_000,
      scraperLeaseWaitDeps: h.deps,
    });

    assert.deepEqual(result, { resultado: "aprobado", razon: null });
    assert.deepEqual(h.sleeps, [1_000, 1_000]);
    assert.equal(h.claimTokens.length, 3);
    assert.equal(fetchCalls(), 1);
    // Solo se libera el token del claim exitoso: nunca dos leases propios.
    assert.deepEqual(h.releaseTokens, [h.claimTokens[2]]);
    assert.deepEqual(
      h.inserts.map((r) => [r.resultado, r.razon]),
      [
        ["pending_error", "job_started"],
        ["aprobado", null],
      ],
    );
    assert.equal(h.rpcCalls.length, 1);
    assert.equal(h.rpcCalls[0]?.fn, "auto_upsert_editor_decision");
  });

  it("ocupado toda la ventana: scraper_busy, sin scraper ni intentos persistidos", async () => {
    const fetchCalls = aprobadoFetch();
    const h = leaseHarness([false]);

    const result = await runAutoPrecalificarJob({
      ...baseInput,
      supabase: h.supabase as never,
      scraperBusyWaitMs: 10_000,
      scraperLeaseWaitDeps: h.deps,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: AUTO_PRECAL_SCRAPER_BUSY_REASON,
    });
    assert.equal(fetchCalls(), 0);
    assert.equal(
      h.sleeps.reduce((a, b) => a + b, 0),
      10_000,
    );
    assert.equal(h.claimTokens.length, 11);
    assert.equal(
      h.inserts.some((r) => r.razon === "scraper_failed"),
      false,
    );
    assert.deepEqual(h.inserts, []);
    assert.deepEqual(h.releaseTokens, []);
    assert.deepEqual(h.rpcCalls, []);
  });

  it("claim inicial con error de RPC: no espera, no scraper, no intentos, no release", async () => {
    const fetchCalls = aprobadoFetch();
    const h = leaseHarness(["rpc_error", true]);

    const result = await runAutoPrecalificarJob({
      ...baseInput,
      supabase: h.supabase as never,
      scraperBusyWaitMs: 10_000,
      scraperLeaseWaitDeps: h.deps,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: AUTO_PRECAL_SCRAPER_BUSY_REASON,
    });
    assert.equal(h.claimTokens.length, 1);
    assert.deepEqual(h.sleeps, []);
    assert.equal(fetchCalls(), 0);
    assert.deepEqual(h.inserts, []);
    assert.deepEqual(h.releaseTokens, []);
    assert.deepEqual(h.rpcCalls, []);
  });

  it("error de RPC durante la espera: aborta tras 1s, sin scraper ni scraper_failed", async () => {
    const fetchCalls = aprobadoFetch();
    const h = leaseHarness([false, "rpc_error", true]);

    const result = await runAutoPrecalificarJob({
      ...baseInput,
      supabase: h.supabase as never,
      scraperBusyWaitMs: 10_000,
      scraperLeaseWaitDeps: h.deps,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: AUTO_PRECAL_SCRAPER_BUSY_REASON,
    });
    assert.deepEqual(h.sleeps, [1_000]);
    assert.equal(h.claimTokens.length, 2);
    assert.equal(fetchCalls(), 0);
    assert.equal(
      h.inserts.some((r) => r.razon === "scraper_failed"),
      false,
    );
    assert.deepEqual(h.inserts, []);
    assert.deepEqual(h.releaseTokens, []);
    assert.deepEqual(h.rpcCalls, []);
  });

  it("scraperBusyWaitMs omitido: comportamiento anterior (1 claim, sin sleep)", async () => {
    const fetchCalls = aprobadoFetch();
    const h = leaseHarness([false, true]);

    const result = await runAutoPrecalificarJob({
      ...baseInput,
      supabase: h.supabase as never,
      scraperLeaseWaitDeps: h.deps,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: AUTO_PRECAL_SCRAPER_BUSY_REASON,
    });
    assert.equal(h.claimTokens.length, 1);
    assert.deepEqual(h.sleeps, []);
    assert.equal(fetchCalls(), 0);
    assert.deepEqual(h.inserts, []);
  });

  it("scraperBusyWaitMs 0: comportamiento anterior (1 claim, sin sleep)", async () => {
    const fetchCalls = aprobadoFetch();
    const h = leaseHarness([false, true]);

    const result = await runAutoPrecalificarJob({
      ...baseInput,
      supabase: h.supabase as never,
      scraperBusyWaitMs: 0,
      scraperLeaseWaitDeps: h.deps,
    });

    assert.deepEqual(result, {
      resultado: "pending_error",
      razon: AUTO_PRECAL_SCRAPER_BUSY_REASON,
    });
    assert.equal(h.claimTokens.length, 1);
    assert.deepEqual(h.sleeps, []);
    assert.equal(fetchCalls(), 0);
    assert.deepEqual(h.inserts, []);
  });

  it("scraperBusyWaitMs mayor a 10s se recorta a 10s", async () => {
    aprobadoFetch();
    const h = leaseHarness([false]);

    await runAutoPrecalificarJob({
      ...baseInput,
      supabase: h.supabase as never,
      scraperBusyWaitMs: 60_000,
      scraperLeaseWaitDeps: h.deps,
    });

    assert.equal(
      h.sleeps.reduce((a, b) => a + b, 0),
      10_000,
    );
  });
});
