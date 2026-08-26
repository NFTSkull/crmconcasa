import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySheetInventoryToSlots } from "./apply-inventory-availability";
import {
  BIOMETRIC_INVENTORY_SYNCED_LABEL,
  LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE,
  isContradictoryBiometricInventoryUi,
  reconcileBookingErrorAfterAvailabilityResync,
  resolveBookGateBlockMessage,
  shouldBlockBookWithoutLiveSync,
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

describe("book_gate UI state — captura 2026-09-04 Monterrey 10:00", () => {
  it("Caso A: book_gate fresh=true canBook=true → NO UNVERIFIED", () => {
    const gate = { fresh: true, canBook: true, daily_remaining: 15, gateMessage: null };
    const blocked = shouldBlockBookWithoutLiveSync({
      kind: "biometricos",
      locationId: FIXTURE_LOCATION,
      bookingDate: FIXTURE_DATE,
      gate,
    });
    assert.equal(blocked.block, false);
    const msg = resolveBookGateBlockMessage({ gate, blocked });
    assert.notEqual(msg, LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE);
  });

  it("Caso B: book_gate null → bloqueo seguro + re-sync limpia UNVERIFIED stale", () => {
    const gate = null;
    const blocked = shouldBlockBookWithoutLiveSync({
      kind: "biometricos",
      locationId: FIXTURE_LOCATION,
      bookingDate: FIXTURE_DATE,
      gate,
    });
    assert.equal(blocked.block, true);
    const msg = resolveBookGateBlockMessage({ gate, blocked });
    assert.equal(msg, LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE);

    const invUi = applySheetInventoryToSlots([], availabilityFresh, FIXTURE_DATE);
    assert.equal(invUi.inventoryLabel, BIOMETRIC_INVENTORY_SYNCED_LABEL);
    assert.equal(
      isContradictoryBiometricInventoryUi({
        inventoryFresh: true,
        inventoryLabel: invUi.inventoryLabel,
        bookingError: msg,
      }),
      true,
    );

    const reconciled = reconcileBookingErrorAfterAvailabilityResync({
      previousError: msg,
      inventoryFresh: true,
    });
    assert.equal(reconciled, null);
  });

  it("Caso C: book_gate fresh=true canBook=false → motivo real, NO UNVERIFIED", () => {
    const gate = {
      fresh: true,
      canBook: false,
      gateMessage: "Cupo diario completo para esta fecha.",
      code: null,
    };
    const blocked = shouldBlockBookWithoutLiveSync({
      kind: "biometricos",
      locationId: FIXTURE_LOCATION,
      bookingDate: FIXTURE_DATE,
      gate,
    });
    assert.equal(blocked.block, true);
    const msg = resolveBookGateBlockMessage({ gate, blocked });
    assert.equal(msg, "Cupo diario completo para esta fecha.");
    assert.notEqual(msg, LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE);
  });

  it("Caso C (sin gateMessage): usa BOOK_SLOT_JUST_TAKEN, NO UNVERIFIED", () => {
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

  it("invariante: fresh synced + UNVERIFIED es contradictorio", () => {
    assert.equal(
      isContradictoryBiometricInventoryUi({
        inventoryFresh: true,
        inventoryLabel: BIOMETRIC_INVENTORY_SYNCED_LABEL,
        bookingError: LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE,
      }),
      true,
    );
    assert.equal(
      isContradictoryBiometricInventoryUi({
        inventoryFresh: true,
        inventoryLabel: BIOMETRIC_INVENTORY_SYNCED_LABEL,
        bookingError: BOOK_SLOT_JUST_TAKEN_MESSAGE,
      }),
      false,
    );
  });
});
