import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginMesaBandejaCountsFetch,
  mesaBandejaCountsForDisplay,
  shouldApplyMesaBandejaCounts,
} from "./mesaBandejaCountsAsync";

describe("P203 Mesa counts async MP1–MP3", () => {
  it("MP3 A counts after B: A ignored", () => {
    const genRef = { current: 0 };
    const a = beginMesaBandejaCountsFetch(genRef, "filter-A");
    const b = beginMesaBandejaCountsFetch(genRef, "filter-B");
    assert.equal(b.gen, 2);
    assert.equal(
      shouldApplyMesaBandejaCounts({
        attempt: a,
        activeCountsGen: genRef.current,
        activeListQueryKey: "filter-B",
      }),
      false,
    );
    assert.equal(
      shouldApplyMesaBandejaCounts({
        attempt: b,
        activeCountsGen: genRef.current,
        activeListQueryKey: "filter-B",
      }),
      true,
    );
  });

  it("MP2 counts do not imply list identity match unless keys equal", () => {
    assert.equal(
      mesaBandejaCountsForDisplay({
        serverCounts: { totalBandeja: 10 },
        countsQueryKey: "old",
        activeListQueryKey: "new",
      }),
      null,
    );
    assert.deepEqual(
      mesaBandejaCountsForDisplay({
        serverCounts: { totalBandeja: 10 },
        countsQueryKey: "same",
        activeListQueryKey: "same",
      }),
      { totalBandeja: 10 },
    );
  });

  it("never invents zero when counts pending", () => {
    assert.equal(
      mesaBandejaCountsForDisplay({
        serverCounts: null,
        countsQueryKey: null,
        activeListQueryKey: "x",
      }),
      null,
    );
  });
});
