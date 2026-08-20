import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  beginMesaBandejaAppend,
  beginMesaBandejaFirstPage,
  mesaBandejaAttemptIsCurrent,
} from "./mesaBandejaInfiniteQuery";
import {
  beginMesaBandejaCountsFetch,
  shouldApplyMesaBandejaCounts,
} from "./mesaBandejaCountsAsync";

/**
 * P203 MP1/MP2/MP4: lista sin counts y counts async no mutan cursor/casos.
 * (R1–R8 viven en mesaBandejaInfiniteQuery.test.ts — se re-ejecutan en gates.)
 */
describe("P203 Mesa list/counts isolation MP1–MP4", () => {
  it("MP1 list attempt is independent of counts gen", () => {
    const listGen = { current: 0 };
    const activeKey = { current: "" };
    const cursor = { current: null as { sortTs: string; id: string } | null };
    const cursorKey = { current: null as string | null };
    const listAttempt = beginMesaBandejaFirstPage(
      listGen,
      activeKey,
      cursor,
      cursorKey,
      "filter-A",
    );
    const countsGen = { current: 0 };
    const countsAttempt = beginMesaBandejaCountsFetch(countsGen, "filter-A");
    assert.equal(listAttempt.gen, 1);
    assert.equal(countsAttempt.gen, 1);
    assert.equal(
      mesaBandejaAttemptIsCurrent(listAttempt, {
        gen: listGen.current,
        queryKey: activeKey.current,
      }),
      true,
    );
    // Counts applying does not require list gen equality
    assert.equal(
      shouldApplyMesaBandejaCounts({
        attempt: countsAttempt,
        activeCountsGen: countsGen.current,
        activeListQueryKey: activeKey.current,
      }),
      true,
    );
  });

  it("MP2/MP4 append keeps list gen; counts key change ignores stale", () => {
    const listGen = { current: 5 };
    const activeKey = { current: "filter-A" };
    const append = beginMesaBandejaAppend(listGen, activeKey, "filter-A");
    assert.equal(append.append, true);
    assert.equal(append.gen, 5);
    const countsGen = { current: 0 };
    const stale = beginMesaBandejaCountsFetch(countsGen, "filter-A");
    beginMesaBandejaCountsFetch(countsGen, "filter-B");
    activeKey.current = "filter-B";
    assert.equal(
      shouldApplyMesaBandejaCounts({
        attempt: stale,
        activeCountsGen: countsGen.current,
        activeListQueryKey: activeKey.current,
      }),
      false,
    );
  });
});
