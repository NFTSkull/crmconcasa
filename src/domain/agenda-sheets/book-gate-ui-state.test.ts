import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySheetInventoryToSlots } from "./apply-inventory-availability";
import {
  BIOMETRIC_INVENTORY_SYNCED_LABEL,
  LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE,
  preserveBookGateErrorAfterAvailabilityFallback,
  resolveBiometricBookGateAttempt,
  resolveBookGateBlockMessage,
  shouldBlockBookWithoutLiveSync,
  shouldShowBiometricInventorySyncedLabel,
} from "./daily-capacity";
import { BOOK_SLOT_JUST_TAKEN_MESSAGE } from "./manual-occupancy";

const FIXTURE_DATE = "2026-09-04";
const FIXTURE_LOCATION = "monterrey";

const availabilityFresh = {
  ok: true,
  fresh: true,
  enforced: true,
  daily_remaining: 15,
  slots: [
    { slot_time: "08:00", available: 7, physical_total: 8 },
    { slot_time: "10:00", available: 8, physical_total: 10 },
  ],
} as const;

describe("book_gate UI state — hotfix v4", () => {
  it("Caso A: book_gate fresh=true canBook=true → continúa a booking", () => {
    const gate = { fresh: true, canBook: true, daily_remaining: 15, gateMessage: null };
    const attempt = resolveBiometricBookGateAttempt({
      kind: "biometricos",
      locationId: FIXTURE_LOCATION,
      bookingDate: FIXTURE_DATE,
      gate,
    });
    assert.equal(attempt.blocked, false);
    assert.equal(attempt.bookGateError, null);
    assert.equal(attempt.mayCallBookBiometricos, true);
  });

  it("Caso B: book_gate null + availability fallback fresh → bloqueado y error visible", () => {
    const attempt = resolveBiometricBookGateAttempt({
      kind: "biometricos",
      locationId: FIXTURE_LOCATION,
      bookingDate: FIXTURE_DATE,
      gate: null,
    });
    assert.equal(attempt.blocked, true);
    assert.equal(attempt.bookGateError, LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE);
    assert.equal(attempt.mayCallBookBiometricos, false);

    const invUi = applySheetInventoryToSlots([], availabilityFresh, FIXTURE_DATE);
    assert.equal(invUi.inventoryLabel, BIOMETRIC_INVENTORY_SYNCED_LABEL);

    const preserved = preserveBookGateErrorAfterAvailabilityFallback({
      bookGateError: attempt.bookGateError!,
      inventoryFresh: true,
    });
    assert.equal(preserved, LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE);

    assert.equal(
      shouldShowBiometricInventorySyncedLabel({
        inventoryLabel: invUi.inventoryLabel,
        bookGateError: preserved,
      }),
      false,
    );
  });

  it("Caso C: book_gate fresh=true canBook=false → motivo real", () => {
    const gate = {
      fresh: true,
      canBook: false,
      gateMessage: "Cupo diario completo para esta fecha.",
      code: null,
    };
    const attempt = resolveBiometricBookGateAttempt({
      kind: "biometricos",
      locationId: FIXTURE_LOCATION,
      bookingDate: FIXTURE_DATE,
      gate,
    });
    assert.equal(attempt.blocked, true);
    assert.equal(attempt.bookGateError, "Cupo diario completo para esta fecha.");
    assert.notEqual(attempt.bookGateError, LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE);
  });

  it("Caso C (sin gateMessage): usa BOOK_SLOT_JUST_TAKEN", () => {
    const gate = { fresh: true, canBook: false, gateMessage: null, code: null };
    const blocked = shouldBlockBookWithoutLiveSync({
      kind: "biometricos",
      locationId: FIXTURE_LOCATION,
      bookingDate: FIXTURE_DATE,
      gate,
    });
    const msg = resolveBookGateBlockMessage({ gate, blocked });
    assert.equal(msg, BOOK_SLOT_JUST_TAKEN_MESSAGE);
    assert.notEqual(msg, LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE);
  });

  it("Caso D: fresh=true canBook=true → mayCallBookBiometricos", () => {
    const attempt = resolveBiometricBookGateAttempt({
      kind: "biometricos",
      locationId: FIXTURE_LOCATION,
      bookingDate: FIXTURE_DATE,
      gate: { fresh: true, canBook: true },
    });
    assert.equal(attempt.mayCallBookBiometricos, true);
  });

  it("Caso E: fallback fresh=true NO borra bookGateError previo", () => {
    const err = LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE;
    assert.equal(
      preserveBookGateErrorAfterAvailabilityFallback({
        bookGateError: err,
        inventoryFresh: true,
      }),
      err,
    );
  });

  it("sin bookGateError: label synced visible", () => {
    assert.equal(
      shouldShowBiometricInventorySyncedLabel({
        inventoryLabel: BIOMETRIC_INVENTORY_SYNCED_LABEL,
        bookGateError: null,
      }),
      true,
    );
  });
});
