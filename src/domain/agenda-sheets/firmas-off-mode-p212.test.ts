import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firmasBookGateBlockedByInactiveContract,
  resolveFirmasContractForDate,
} from "./firmas-live-sync-contract";
import {
  filterFirmasPickerSlotTimes,
  FIRMAS_DAILY_CAP_CONTRACT_DEFAULT,
} from "./firmas-bookable-slots";
import { agendaDailyCapacity } from "./daily-capacity";

describe("P212 live-sync OFF: 08:00 no operational", () => {
  it("contract OFF + 08:00 → block", () => {
    const r = firmasBookGateBlockedByInactiveContract({
      kind: "firmas",
      contractEnabled: false,
      slotTime: "08:00",
    });
    assert.equal(r.block, true);
    assert.match(r.message ?? "", /contrato|P212|no activo/i);
  });

  it("contract OFF + legacy 09:00 → no block aquí (config decide)", () => {
    const r = firmasBookGateBlockedByInactiveContract({
      kind: "firmas",
      contractEnabled: false,
      slotTime: "09:00",
    });
    assert.equal(r.block, false);
  });

  it("contract ON + 08:00 → no block en este helper", () => {
    const r = firmasBookGateBlockedByInactiveContract({
      kind: "firmas",
      contractEnabled: true,
      slotTime: "08:00",
    });
    assert.equal(r.block, false);
  });

  it("effective_from futuro desactiva", () => {
    const c = resolveFirmasContractForDate(
      { enabled: true, effectiveFrom: "2026-10-01" },
      "2026-09-15",
    );
    assert.equal(c.enabled, false);
  });
});

describe("P212 FE OFF: picker legacy desde config", () => {
  const legacy = ["08:30", "09:00", "09:30", "10:00", "10:30"] as const;
  const target = ["08:00", "09:00", "10:00"] as const;

  it("contract OFF → allSlotTimes intactos (no hardcode 08/09/10)", () => {
    const out = filterFirmasPickerSlotTimes({
      allSlotTimes: legacy,
      bookingDate: "2026-09-16",
      reagendar: false,
      contract: FIRMAS_DAILY_CAP_CONTRACT_DEFAULT,
    });
    assert.deepEqual([...out], [...legacy]);
    assert.equal(out.includes("08:00"), false);
  });

  it("contract ON → solo 08/09/10", () => {
    const out = filterFirmasPickerSlotTimes({
      allSlotTimes: ["08:30", "08:00", "09:00", "09:30", "10:00", "10:30"],
      bookingDate: "2026-09-16",
      reagendar: false,
      contract: { enabled: true, effectiveFrom: "2026-09-01" },
    });
    assert.deepEqual([...out], ["08:00", "09:00", "10:00"]);
  });

  it("daily capacity Firmas null con contract OFF", () => {
    assert.equal(agendaDailyCapacity("firmas", "monterrey"), null);
    assert.equal(agendaDailyCapacity("firmas", "apodaca", { enabled: false }), null);
    assert.equal(
      agendaDailyCapacity("firmas", "monterrey", { enabled: true, effectiveFrom: null }),
      15,
    );
    assert.equal(agendaDailyCapacity("biometricos", "monterrey"), 15);
  });
});
