import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPlausibleFirmasApodacaTime,
  isPlausibleFirmasMonterreyTime,
  resolveOrphanSection,
} from "./section-recovery";

describe("section-recovery", () => {
  it("Apodaca firmas times", () => {
    assert.equal(isPlausibleFirmasApodacaTime("10:30"), true);
    assert.equal(isPlausibleFirmasApodacaTime("10:00"), true);
    assert.equal(isPlausibleFirmasApodacaTime("08:30"), false);
  });

  it("Monterrey firmas times", () => {
    assert.equal(isPlausibleFirmasMonterreyTime("08:30"), true);
    assert.equal(isPlausibleFirmasMonterreyTime("10:30"), false);
  });

  it("next MONTERREY FIRMAS + 10:30 → apodaca/firmas", () => {
    const r = resolveOrphanSection({
      orphanTimes: ["10:30", "10:30", "10:30"],
      orphanSheetRows: [3, 4, 5],
      nextSection: { sede: "monterrey", kind: "firmas" },
      prevSection: null,
    });
    assert.deepEqual(r, { sede: "apodaca", kind: "firmas" });
  });

  it("no asigna Apodaca a 08:30 huérfano", () => {
    const r = resolveOrphanSection({
      orphanTimes: ["08:30"],
      orphanSheetRows: [2],
      nextSection: { sede: "monterrey", kind: "firmas" },
      prevSection: null,
    });
    assert.equal(r, null);
  });

  it("hints unánimes ganan", () => {
    const hints = new Map([
      [3, { sede: "apodaca" as const, kind: "firmas" as const }],
      [4, { sede: "apodaca" as const, kind: "firmas" as const }],
    ]);
    const r = resolveOrphanSection({
      orphanTimes: ["11:00", "11:00"],
      orphanSheetRows: [3, 4],
      nextSection: null,
      prevSection: null,
      hints,
    });
    assert.deepEqual(r, { sede: "apodaca", kind: "firmas" });
  });
});
