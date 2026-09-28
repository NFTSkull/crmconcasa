import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAutoPrecalRetryablePendingReason } from "./auto-precal-retry";
import {
  AUTO_PRECAL_SCRAPER_BUSY_MAX_WAIT_MS,
  AUTO_PRECAL_SCRAPER_BUSY_POLL_MS,
  AUTO_PRECAL_SCRAPER_BUSY_REASON,
  AUTO_PRECAL_SCRAPER_LEASE_SECONDS,
  clampAutoPrecalScraperBusyWaitMs,
  releaseAutoPrecalScraperLease,
  tryClaimAutoPrecalScraperLease,
  waitForAutoPrecalScraperLease,
} from "./auto-precal-scraper-lease";

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    advance(ms: number) {
      t += ms;
    },
    deps: {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    },
  };
}

function claimSequence(
  results: (boolean | "rpc_error")[],
  onClaim?: () => void,
) {
  const claimTokens: string[] = [];
  let i = 0;
  const supabase = {
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "auto_precal_scraper_try_claim") {
        onClaim?.();
        claimTokens.push(String(args.p_owner_token));
        const next = results[Math.min(i, results.length - 1)];
        i += 1;
        if (next === "rpc_error") {
          return Promise.resolve({ error: { message: "boom" }, data: null });
        }
        return Promise.resolve({ error: null, data: next });
      }
      return Promise.resolve({ error: null, data: null });
    },
  };
  return { supabase, claimTokens };
}

describe("auto-precal scraper global lease", () => {
  it("reclama y libera con el mismo owner token", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const supabase = {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        if (fn === "auto_precal_scraper_try_claim") {
          return Promise.resolve({ error: null, data: true });
        }
        return Promise.resolve({ error: null, data: null });
      },
    };

    const claim = await tryClaimAutoPrecalScraperLease(supabase as never);
    assert.equal(claim.claimed, true);
    assert.ok(claim.ownerToken);
    assert.equal(calls[0]?.fn, "auto_precal_scraper_try_claim");
    assert.equal(
      calls[0]?.args.p_lease_seconds,
      AUTO_PRECAL_SCRAPER_LEASE_SECONDS,
    );

    await releaseAutoPrecalScraperLease(
      supabase as never,
      claim.ownerToken,
    );
    assert.equal(calls[1]?.fn, "auto_precal_scraper_release");
    assert.equal(calls[1]?.args.p_owner_token, claim.ownerToken);
  });

  it("lease ocupado no entrega owner token", async () => {
    const supabase = {
      rpc() {
        return Promise.resolve({ error: null, data: false });
      },
    };
    const claim = await tryClaimAutoPrecalScraperLease(supabase as never);
    assert.deepEqual(claim, {
      claimed: false,
      ownerToken: null,
      claimError: false,
    });
  });

  it("error del RPC se distingue de lease ocupado", async () => {
    const supabase = {
      rpc() {
        return Promise.resolve({ error: { message: "boom" }, data: null });
      },
    };
    const claim = await tryClaimAutoPrecalScraperLease(supabase as never);
    assert.deepEqual(claim, {
      claimed: false,
      ownerToken: null,
      claimError: true,
    });
  });

  it("lease adquirido marca claimError=false", async () => {
    const { supabase } = claimSequence([true]);
    const claim = await tryClaimAutoPrecalScraperLease(supabase as never);
    assert.equal(claim.claimed, true);
    assert.equal(claim.claimError, false);
  });

  it("scraper_busy es reintentable", () => {
    assert.equal(
      isAutoPrecalRetryablePendingReason(AUTO_PRECAL_SCRAPER_BUSY_REASON),
      true,
    );
  });

  it("TTL del lease sigue en 180s; espera máx 10s y poll 1s", () => {
    assert.equal(AUTO_PRECAL_SCRAPER_LEASE_SECONDS, 180);
    assert.equal(AUTO_PRECAL_SCRAPER_BUSY_MAX_WAIT_MS, 10_000);
    assert.equal(AUTO_PRECAL_SCRAPER_BUSY_POLL_MS, 1_000);
  });
});

describe("clampAutoPrecalScraperBusyWaitMs", () => {
  it("omitido, 0, negativo o no finito → 0", () => {
    assert.equal(clampAutoPrecalScraperBusyWaitMs(undefined), 0);
    assert.equal(clampAutoPrecalScraperBusyWaitMs(0), 0);
    assert.equal(clampAutoPrecalScraperBusyWaitMs(-5), 0);
    assert.equal(clampAutoPrecalScraperBusyWaitMs(Number.NaN), 0);
    assert.equal(
      clampAutoPrecalScraperBusyWaitMs(Number.POSITIVE_INFINITY),
      0,
    );
  });

  it("nunca excede 10s", () => {
    assert.equal(clampAutoPrecalScraperBusyWaitMs(5_000), 5_000);
    assert.equal(clampAutoPrecalScraperBusyWaitMs(10_000), 10_000);
    assert.equal(clampAutoPrecalScraperBusyWaitMs(60_000), 10_000);
  });
});

describe("waitForAutoPrecalScraperLease", () => {
  it("ocupado → libre: duerme 1s entre claims y devuelve el token exitoso", async () => {
    const clock = fakeClock();
    const { supabase, claimTokens } = claimSequence([false, true]);

    const claim = await waitForAutoPrecalScraperLease(
      supabase as never,
      10_000,
      clock.deps,
    );

    assert.equal(claim.claimed, true);
    assert.deepEqual(clock.sleeps, [1_000, 1_000]);
    assert.equal(claimTokens.length, 2);
    assert.equal(claim.ownerToken, claimTokens[1]);
    assert.equal(claim.waitedMs, 2_000);
  });

  it("ocupado toda la ventana: no entrega token y respeta el tope", async () => {
    const clock = fakeClock();
    const { supabase, claimTokens } = claimSequence([false]);

    const claim = await waitForAutoPrecalScraperLease(
      supabase as never,
      10_000,
      clock.deps,
    );

    assert.deepEqual(claim, {
      claimed: false,
      ownerToken: null,
      claimError: false,
      waitedMs: 10_000,
    });
    assert.equal(
      clock.sleeps.reduce((a, b) => a + b, 0),
      10_000,
    );
    assert.equal(claimTokens.length, 10);
  });

  it("error del RPC durante la espera aborta de inmediato", async () => {
    const clock = fakeClock();
    const { supabase, claimTokens } = claimSequence(["rpc_error", true]);

    const claim = await waitForAutoPrecalScraperLease(
      supabase as never,
      10_000,
      clock.deps,
    );

    assert.deepEqual(claim, {
      claimed: false,
      ownerToken: null,
      claimError: true,
      waitedMs: 1_000,
    });
    assert.deepEqual(clock.sleeps, [1_000]);
    assert.equal(claimTokens.length, 1);
  });

  it("último sleep se recorta al tiempo restante", async () => {
    const clock = fakeClock();
    const { supabase } = claimSequence([false]);

    await waitForAutoPrecalScraperLease(supabase as never, 2_500, clock.deps);

    assert.deepEqual(clock.sleeps, [1_000, 1_000, 500]);
  });

  it("latencia del claim cuenta contra la ventana (reloj real, no suma de sleeps)", async () => {
    const clock = fakeClock();
    const { supabase, claimTokens } = claimSequence([false], () =>
      clock.advance(400),
    );

    const claim = await waitForAutoPrecalScraperLease(
      supabase as never,
      10_000,
      clock.deps,
    );

    // 7×(1000 sleep + 400 rpc) = 9800 → sleep 200 → claim 400: solo excede por un RPC.
    assert.equal(claim.claimed, false);
    assert.equal(claimTokens.length, 8);
    assert.equal(claim.waitedMs, 10_400);
  });

  it("waitMs mayor al tope se recorta a 10s", async () => {
    const clock = fakeClock();
    const { supabase } = claimSequence([false]);

    const claim = await waitForAutoPrecalScraperLease(
      supabase as never,
      60_000,
      clock.deps,
    );

    assert.equal(claim.waitedMs, 10_000);
  });

  it("waitMs 0: no duerme ni reintenta", async () => {
    const clock = fakeClock();
    const { supabase, claimTokens } = claimSequence([true]);

    const claim = await waitForAutoPrecalScraperLease(
      supabase as never,
      0,
      clock.deps,
    );

    assert.equal(claim.claimed, false);
    assert.deepEqual(clock.sleeps, []);
    assert.equal(claimTokens.length, 0);
  });
});
