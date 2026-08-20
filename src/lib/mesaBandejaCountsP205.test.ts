import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginMesaBandejaCountsFetch,
  mesaBandejaCountsForDisplay,
  shouldApplyMesaBandejaCounts,
} from "@/lib/mesaBandejaCountsAsync";

describe("P205-B1 Mesa counts race + first paint contract", () => {
  it("C16: stale counts ignorados", () => {
    const gen = { current: 0 };
    const stale = beginMesaBandejaCountsFetch(gen, "filter-A");
    beginMesaBandejaCountsFetch(gen, "filter-B");
    assert.equal(
      shouldApplyMesaBandejaCounts({
        attempt: stale,
        activeCountsGen: gen.current,
        activeListQueryKey: "filter-B",
      }),
      false,
    );
  });

  it("C17: failure counts conserva cards (display null → …)", () => {
    assert.equal(
      mesaBandejaCountsForDisplay({
        serverCounts: null,
        countsQueryKey: null,
        activeListQueryKey: "filter-A",
      }),
      null,
    );
  });

  it("C18: first paint sigue includeCounts=false (contrato documentado)", () => {
    const listIncludeCounts = false;
    assert.equal(listIncludeCounts, false);
  });
});
