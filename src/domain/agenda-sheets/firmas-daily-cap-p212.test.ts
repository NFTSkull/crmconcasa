import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFirmasStructurePlan,
  compareBiometricChecksums,
  type MemorySheetTab,
} from "./firmas-sheet-structure-planner";
import {
  resolveFirmasBookGateAttempt,
  agendaDailyCapacity,
  agendaDailyRemaining,
  FIRMAS_DAILY_CAPACITY_PER_SEDE,
} from "./daily-capacity";
import {
  filterFirmasPickerSlotTimes,
  isFirmasNewBookableSlotTime,
} from "./firmas-bookable-slots";

function grid(rows: string[][]): MemorySheetTab["grid"] {
  return rows;
}

describe("P212 firmas sheet structure planner", () => {
  it("caso 1: reutiliza blanks → 0 row shift (solo sede con blanks suficientes para gaps)", () => {
    // 5 blanks por horario target × 3 = 15 blanks Monterrey; Apodaca sin sección → STOP parcial
    const blanks = Array.from({ length: 20 }, () =>
      Array.from({ length: 14 }, () => ""),
    );
    const g = grid([
      ["MONTERREY FIRMAS"],
      ["08:30", "legacy"],
      ...blanks,
      ["APODACA FIRMAS"],
      ...blanks,
      ["MONTERREY BIOMETRICOS"],
      ["09:00"],
    ]);
    const plan = buildFirmasStructurePlan({
      sheetId: 1,
      sheetTitle: "16 Septiembre",
      bookingDate: "2026-09-16",
      grid: g,
    });
    assert.equal(plan.canExpandNoShift, true);
    assert.ok(plan.actions.every((a) => a.type === "reuse_row"));
    assert.equal(plan.rejectReason, null);
  });

  it("caso 3: ampliar sin blanks → NO_SAFE_CAPACITY (no insertDimension)", () => {
    const g = grid([
      ["MONTERREY FIRMAS"],
      ["08:30"],
      ["MONTERREY BIOMETRICOS"],
      ["09:00"],
      ["APODACA FIRMAS"],
      ["10:30"],
      ["APODACA BIOMETRICOS"],
      ["09:00"],
    ]);
    const plan = buildFirmasStructurePlan({
      sheetId: 1,
      sheetTitle: "Tight Tab",
      bookingDate: "2026-09-16",
      grid: g,
    });
    assert.equal(plan.canExpandNoShift, false);
    assert.match(plan.rejectReason ?? "", /NO_SAFE_CAPACITY/i);
  });

  it("caso 4-7: filas con B:D / E:N / O:U / linked no reutilizables", () => {
    const g = grid([
      ["MONTERREY FIRMAS"],
      ["08:30"],
      ["", "nss", "nom", "exp"],
      ["", "", "", "", "human"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "meta", "k", "bid"],
    ]);
    const linked = new Set([5]);
    const plan = buildFirmasStructurePlan({
      sheetId: 1,
      sheetTitle: "Occupied",
      bookingDate: "2026-09-16",
      grid: g,
      linkedRows: linked,
    });
    const reusable = plan.rowAnalyses.filter((r) => r.reusableForNewSlot);
    assert.equal(reusable.length, 0);
    assert.ok(plan.rowAnalyses.some((r) => r.classification === "has_b_d"));
    assert.ok(plan.rowAnalyses.some((r) => r.classification === "has_e_n"));
    assert.ok(plan.rowAnalyses.some((r) => r.classification === "linked_claimed"));
  });

  it("checksum biométricos PRE/POST unchanged = 0", () => {
    const g = grid([
      ["MONTERREY BIOMETRICOS"],
      ["08:00", "a"],
    ]);
    const pre = buildFirmasStructurePlan({
      sheetId: 1,
      sheetTitle: "Bio",
      bookingDate: "2026-09-16",
      grid: g,
    }).biometricPreChecksums;
    const post = [...pre];
    const cmp = compareBiometricChecksums(pre, post);
    assert.equal(cmp.changedRows, 0);
  });
});

describe("P212 firmas daily capacity FE", () => {
  it("firmas monterrey/apodaca cap 15", () => {
    assert.equal(agendaDailyCapacity("firmas", "monterrey"), null);
    assert.equal(
      agendaDailyCapacity("firmas", "monterrey", { enabled: true }),
      FIRMAS_DAILY_CAPACITY_PER_SEDE,
    );
    assert.equal(agendaDailyCapacity("firmas", "apodaca", { enabled: true }), 15);
    assert.equal(
      agendaDailyRemaining("firmas", "monterrey", 10, { enabled: true }).remaining,
      5,
    );
    assert.equal(agendaDailyRemaining("firmas", "monterrey", 10).remaining, null);
  });

  it("book gate fail-closed", () => {
    const blocked = resolveFirmasBookGateAttempt({
      kind: "firmas",
      locationId: "monterrey",
      bookingDate: "2026-09-16",
      gate: null,
    });
    assert.equal(blocked.blocked, true);
    assert.ok(blocked.bookGateError);
    const ok = resolveFirmasBookGateAttempt({
      kind: "firmas",
      locationId: "monterrey",
      bookingDate: "2026-09-16",
      gate: { fresh: true, canBook: true },
    });
    assert.equal(ok.blocked, false);
  });

  it("picker solo 08/09/10 bajo contrato; legacy en reagendar", () => {
    assert.equal(isFirmasNewBookableSlotTime("09:00"), true);
    assert.equal(isFirmasNewBookableSlotTime("08:30"), false);
    const off = filterFirmasPickerSlotTimes({
      allSlotTimes: ["08:30", "08:00", "09:00", "10:00", "10:30"],
      bookingDate: "2026-09-16",
      reagendar: false,
    });
    assert.equal(off.length, 5, "contrato default OFF → no filtra por fecha fija");
    const filtered = filterFirmasPickerSlotTimes({
      allSlotTimes: ["08:30", "08:00", "09:00", "10:00", "10:30"],
      bookingDate: "2026-09-16",
      reagendar: true,
      activeBookingTime: "08:30",
      contract: { enabled: true, effectiveFrom: "2026-09-01" },
    });
    assert.deepEqual(filtered, ["08:30", "08:00", "09:00", "10:00"]);
  });
});
