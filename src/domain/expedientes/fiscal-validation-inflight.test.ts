import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createFiscalValidationInFlightGuard } from "./fiscal-validation-inflight";

describe("fiscal-validation-inflight", () => {
  it("bloquea un segundo acquire del mismo expediente", () => {
    const g = createFiscalValidationInFlightGuard();
    assert.equal(g.tryAcquire("aaa"), true);
    assert.equal(g.tryAcquire("aaa"), false);
    assert.equal(g.isInFlight("aaa"), true);
    g.release("aaa");
    assert.equal(g.tryAcquire("aaa"), true);
  });

  it("permite expedientes distintos en paralelo", () => {
    const g = createFiscalValidationInFlightGuard();
    assert.equal(g.tryAcquire("a"), true);
    assert.equal(g.tryAcquire("b"), true);
    g.release("a");
    g.release("b");
  });

  it("ignora id vacío", () => {
    const g = createFiscalValidationInFlightGuard();
    assert.equal(g.tryAcquire(""), false);
    assert.equal(g.tryAcquire("   "), false);
  });
});
