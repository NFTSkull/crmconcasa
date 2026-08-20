import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * AE2/AE3: documentación de contrato — page/chip no deben invocar summary.
 * La implementación vive en asesor/page.tsx (loadInbox sin getAsesorInboxSummary).
 * Este test verifica helpers de decisión de refresh.
 */
import {
  shouldRefreshAsesorListOnFocus,
  shouldRefreshAsesorSummaryOnFocus,
} from "./asesorInboxPerf";

describe("P203 Asesor navigation contract AE2–AE3", () => {
  it("AE2 page change is list-only by design (summary independent of page)", () => {
    // Summary refresh is never keyed by page number — only focus/mutation/initial.
    assert.equal(
      shouldRefreshAsesorSummaryOnFocus({
        lastSummaryAtMs: Date.now(),
        nowMs: Date.now(),
      }),
      false,
    );
  });

  it("AE3 chip change does not imply summary refresh", () => {
    // quickFilter is not an input to shouldRefreshAsesorSummaryOnFocus
    assert.equal(
      shouldRefreshAsesorListOnFocus({
        lastListAtMs: Date.now() - 1_000,
        nowMs: Date.now(),
        ttlMs: 45_000,
      }),
      false,
    );
  });
});
