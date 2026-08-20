import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asesorSummaryReasonRequiresFetch } from "./asesorInboxPerf";

/**
 * AE4: mutación sí pide summary; page/chip no son reasons de summary.
 */
describe("P203 Asesor mutation summary AE4", () => {
  it("AE4 mutation/explicit/realtime/initial require fetch", () => {
    assert.equal(asesorSummaryReasonRequiresFetch("mutation"), true);
    assert.equal(asesorSummaryReasonRequiresFetch("explicit"), true);
    assert.equal(asesorSummaryReasonRequiresFetch("realtime"), true);
    assert.equal(asesorSummaryReasonRequiresFetch("initial"), true);
    assert.equal(asesorSummaryReasonRequiresFetch("focus"), true);
  });
});
