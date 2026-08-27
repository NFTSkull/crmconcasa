import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeFirmasProvisionDeficit,
  detectFutureTabCreationMechanism,
  firmasBookGateRespectsPhysicalRows,
  recommendedFirmasFutureProvisionStrategy,
  simulateIdempotentProvisionPasses,
} from "./firmas-future-tabs-provisioning";

describe("P212 Fase 1.7 future tabs + provisioner", () => {
  it("repo evidence → manual_or_external; strategy = idempotent provisioner", () => {
    const m = detectFutureTabCreationMechanism({
      repoCreatesTabs: false,
      hasTabDuplicateScript: false,
      hasTabCron: false,
      docsSayNoCreateTabs: true,
    });
    assert.equal(m, "manual_or_external");
    assert.equal(
      recommendedFirmasFutureProvisionStrategy(m),
      "idempotent_append_only_provisioner",
    );
  });

  it("déficit: 3→add2; 5→add0; nunca final>5", () => {
    const d = computeFirmasProvisionDeficit({
      sede: "apodaca",
      physicalCountsByHour: { "08:00": 3, "09:00": 5, "10:00": 0 },
    });
    assert.equal(d.hours["08:00"].add, 2);
    assert.equal(d.hours["09:00"].add, 0);
    assert.equal(d.hours["10:00"].add, 5);
    assert.equal(d.addTotal, 7);
    for (const h of ["08:00", "09:00", "10:00"] as const) {
      assert.ok(d.hours[h].final <= 5);
    }
  });

  it("idempotencia: 2ª pass addTotal=0", () => {
    const passes = simulateIdempotentProvisionPasses({
      initialCounts: { "08:00": 3, "09:00": 1, "10:00": 0 },
      passes: 2,
    });
    assert.equal(passes[0]!.addTotal, 11);
    assert.equal(passes[1]!.addTotal, 0);
    assert.deepEqual(passes[1]!.countsAfter, {
      "08:00": 5,
      "09:00": 5,
      "10:00": 5,
    });
  });

  it("booking gate fail-closed si Sheet < SQL capacity", () => {
    const g = firmasBookGateRespectsPhysicalRows({
      sqlHourlyCapacity: 5,
      physicalAvailableRows: 2,
    });
    assert.equal(g.allowBookSlots, 2);
    assert.match(g.reason, /PHYSICAL/);
  });
});
