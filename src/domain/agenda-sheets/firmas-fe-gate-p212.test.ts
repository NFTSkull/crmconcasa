import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveFirmasBookGateAttempt,
  preserveBookGateErrorAfterAvailabilityFallback,
  shouldShowFirmasInventorySyncedLabel,
  FIRMAS_INVENTORY_SYNCED_LABEL,
  agendaDailyCapacity,
  BIOMETRICOS_MONTERREY_DAILY_CAPACITY,
  FIRMAS_DAILY_CAPACITY_PER_SEDE,
} from "./daily-capacity";
import {
  agendaBookingCrmSuccessCopy,
  nextAgendaBookingSheetSyncUi,
} from "../../lib/agendaBookingSheetSyncUi";

describe("P212 FE Firmas fail-closed gate", () => {
  it("null gate → no book", () => {
    const a = resolveFirmasBookGateAttempt({
      kind: "firmas",
      locationId: "monterrey",
      bookingDate: "2026-09-16",
      gate: null,
    });
    assert.equal(a.blocked, true);
    assert.equal(a.mayCallBookBiometricos, false);
  });

  it("fresh=false → no book", () => {
    const a = resolveFirmasBookGateAttempt({
      kind: "firmas",
      locationId: "apodaca",
      bookingDate: "2026-09-16",
      gate: { fresh: false, canBook: false },
    });
    assert.equal(a.blocked, true);
  });

  it("canBook=false → no book", () => {
    const a = resolveFirmasBookGateAttempt({
      kind: "firmas",
      locationId: "monterrey",
      bookingDate: "2026-09-16",
      gate: { fresh: true, canBook: false, gateMessage: "ocupado" },
    });
    assert.equal(a.blocked, true);
    assert.match(a.bookGateError ?? "", /ocupado|cupo|ocup/i);
  });

  it("fresh+canBook true → allow once", () => {
    const a = resolveFirmasBookGateAttempt({
      kind: "firmas",
      locationId: "monterrey",
      bookingDate: "2026-09-16",
      gate: { fresh: true, canBook: true },
    });
    assert.equal(a.blocked, false);
    assert.equal(a.mayCallBookBiometricos, true);
  });

  it("fallback availability no limpia bookGateError", () => {
    const kept = preserveBookGateErrorAfterAvailabilityFallback({
      bookGateError: "gate fail",
      inventoryFresh: true,
    });
    assert.equal(kept, "gate fail");
    assert.equal(
      shouldShowFirmasInventorySyncedLabel({
        inventoryLabel: FIRMAS_INVENTORY_SYNCED_LABEL,
        bookGateError: "gate fail",
      }),
      false,
    );
  });
});

describe("P212 FE Firmas sync UI", () => {
  it("CRM success copy is pending firmas, not synced", () => {
    const msg = agendaBookingCrmSuccessCopy("book", "firmas");
    assert.match(msg, /firmas/i);
    assert.match(msg, /sincronizando|CRM/i);
    assert.doesNotMatch(msg, /sincronizada con agenda\.?$/i);
  });

  it("PENDING → SYNCED → FAILED transitions", () => {
    const pending = nextAgendaBookingSheetSyncUi({
      kind: "book",
      status: "PENDING",
      attempts: 1,
      maxAttempts: 10,
      agendaKind: "firmas",
    });
    assert.match(pending.message, /sincronizando/i);
    assert.equal(pending.done, false);

    const synced = nextAgendaBookingSheetSyncUi({
      kind: "book",
      status: "SYNCED",
      attempts: 2,
      maxAttempts: 10,
      agendaKind: "firmas",
    });
    assert.match(synced.message, /firmas.*sincronizada|sincronizada.*firmas/i);
    assert.equal(synced.done, true);

    const failed = nextAgendaBookingSheetSyncUi({
      kind: "book",
      status: "FAILED",
      attempts: 3,
      maxAttempts: 10,
      agendaKind: "firmas",
    });
    assert.equal(failed.done, true);
    assert.doesNotMatch(failed.message, /sincronizada con agenda\.?$/i);
  });
});

describe("P212 Edge daily capacity regression", () => {
  it("Firmas MTY/APO = 15 solo con contract ON; Bio MTY = 15; Bio APO null", () => {
    assert.equal(agendaDailyCapacity("firmas", "monterrey"), null);
    assert.equal(
      agendaDailyCapacity("firmas", "monterrey", { enabled: true }),
      FIRMAS_DAILY_CAPACITY_PER_SEDE,
    );
    assert.equal(agendaDailyCapacity("firmas", "apodaca", { enabled: true }), 15);
    assert.equal(agendaDailyCapacity("biometricos", "monterrey"), BIOMETRICOS_MONTERREY_DAILY_CAPACITY);
    assert.equal(agendaDailyCapacity("biometricos", "apodaca"), null);
  });
});
