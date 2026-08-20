import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASESOR_INBOX_FOCUS_TTL_MS,
  createAsesorSummarySingleFlight,
  shouldRefreshAsesorListOnFocus,
  shouldRefreshAsesorSummaryOnFocus,
} from "./asesorInboxPerf";

describe("P203 Asesor summary / focus AE10–AE12", () => {
  it("AE10 focus within TTL: no refresh", () => {
    const now = 100_000;
    assert.equal(
      shouldRefreshAsesorSummaryOnFocus({
        lastSummaryAtMs: now - 10_000,
        nowMs: now,
        ttlMs: ASESOR_INBOX_FOCUS_TTL_MS,
      }),
      false,
    );
    assert.equal(
      shouldRefreshAsesorListOnFocus({
        lastListAtMs: now - 10_000,
        nowMs: now,
      }),
      false,
    );
  });

  it("AE11 focus outside TTL: refresh allowed", () => {
    const now = 100_000;
    assert.equal(
      shouldRefreshAsesorSummaryOnFocus({
        lastSummaryAtMs: now - 50_000,
        nowMs: now,
      }),
      true,
    );
  });

  it("AE12 single-flight: 2 triggers = 1 factory call", async () => {
    const sf = createAsesorSummarySingleFlight<number>();
    let calls = 0;
    const factory = () => {
      calls += 1;
      return new Promise<number>((resolve) => {
        setTimeout(() => resolve(42), 20);
      });
    };
    const [a, b] = await Promise.all([
      sf.run("asesor-1", factory),
      sf.run("asesor-1", factory),
    ]);
    assert.equal(a, 42);
    assert.equal(b, 42);
    assert.equal(calls, 1);
  });

  it("different keys do not share flight", async () => {
    const sf = createAsesorSummarySingleFlight<string>();
    let calls = 0;
    const [a, b] = await Promise.all([
      sf.run("a", async () => {
        calls += 1;
        return "A";
      }),
      sf.run("b", async () => {
        calls += 1;
        return "B";
      }),
    ]);
    assert.equal(a, "A");
    assert.equal(b, "B");
    assert.equal(calls, 2);
  });
});
