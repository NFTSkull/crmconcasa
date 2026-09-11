import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAutoPrecalRetryablePendingReason } from "./auto-precal-retry";
import {
  AUTO_PRECAL_SCRAPER_BUSY_REASON,
  AUTO_PRECAL_SCRAPER_LEASE_SECONDS,
  releaseAutoPrecalScraperLease,
  tryClaimAutoPrecalScraperLease,
} from "./auto-precal-scraper-lease";

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
    assert.deepEqual(claim, { claimed: false, ownerToken: null });
  });

  it("scraper_busy es reintentable", () => {
    assert.equal(
      isAutoPrecalRetryablePendingReason(AUTO_PRECAL_SCRAPER_BUSY_REASON),
      true,
    );
  });
});
