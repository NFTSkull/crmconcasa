import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideCancelMissingCoords,
  decidePriorCancelGate,
  hadSheetEvidenceFromPayload,
  rescheduleMoveIdempotencyKey,
  resolveCancelSheetCoords,
  shouldRestorePriorAfterCreateFailure,
  sortOutboxForRescheduleMove,
} from "./reschedule-sheet-move";

describe("reschedule-sheet-move — prior cancel gate", () => {
  it("permite create sin prior", () => {
    const d = decidePriorCancelGate({
      priorCancelledBookingId: null,
      priorCancelOutboxPending: false,
      priorActiveLinkExists: false,
      priorSheetRowStillOwned: false,
    });
    assert.equal(d.allowCreate, true);
  });

  it("bloquea si outbox cancel pendiente", () => {
    const d = decidePriorCancelGate({
      priorCancelledBookingId: "old-1",
      priorCancelOutboxPending: true,
      priorActiveLinkExists: false,
      priorSheetRowStillOwned: false,
    });
    assert.equal(d.allowCreate, false);
    if (!d.allowCreate) {
      assert.equal(d.reason, "awaiting_prior_cancel_outbox");
    }
  });

  it("bloquea si la fila Sheet aún tiene P=prior", () => {
    const d = decidePriorCancelGate({
      priorCancelledBookingId: "old-1",
      priorCancelOutboxPending: false,
      priorActiveLinkExists: false,
      priorSheetRowStillOwned: true,
    });
    assert.equal(d.allowCreate, false);
  });

  it("permite cuando prior limpio", () => {
    const d = decidePriorCancelGate({
      priorCancelledBookingId: "old-1",
      priorCancelOutboxPending: false,
      priorActiveLinkExists: false,
      priorSheetRowStillOwned: false,
    });
    assert.deepEqual(d, { allowCreate: true, reason: "prior_cleared" });
  });
});

describe("reschedule-sheet-move — coords e evidencia", () => {
  it("prefiere payload sobre link", () => {
    const r = resolveCancelSheetCoords({
      payloadSheetId: 1,
      payloadSheetTitle: "03 AGOSTO ",
      payloadSheetRow: 23,
      activeLink: { sheetId: 9, sheetTitle: "OTHER", rowNumber: 99 },
    });
    assert.equal(r.source, "payload");
    assert.equal(r.sheetRow, 23);
  });

  it("usa soft-deleted link si payload vacío (post-release inventario)", () => {
    const r = resolveCancelSheetCoords({
      softDeletedLink: {
        sheetId: 2,
        sheetTitle: "03 AGOSTO ",
        rowNumber: 38,
      },
    });
    assert.equal(r.source, "soft_deleted_link");
    assert.equal(r.sheetRow, 38);
  });

  it("sin evidencia → done_noop; con evidencia → failed", () => {
    assert.equal(
      decideCancelMissingCoords({ hadSheetEvidence: false }),
      "done_noop",
    );
    assert.equal(
      decideCancelMissingCoords({ hadSheetEvidence: true }),
      "failed_missing_coords",
    );
    assert.equal(
      hadSheetEvidenceFromPayload({ sheet_row: 10, sheet_title: "X" }),
      true,
    );
    assert.equal(hadSheetEvidenceFromPayload({}), false);
  });
});

describe("reschedule-sheet-move — orden, restore, idempotencia", () => {
  it("ordena cancel antes que create (mismo día / distinta hora)", () => {
    const sorted = sortOutboxForRescheduleMove([
      { event_type: "booking_created", created_at: "2026-08-06T10:00:02Z" },
      { event_type: "booking_cancelled", created_at: "2026-08-06T10:00:01Z" },
    ]);
    assert.equal(sorted[0]?.event_type, "booking_cancelled");
    assert.equal(sorted[1]?.event_type, "booking_created");
  });

  it("restore solo si create falló tras clear en el mismo batch", () => {
    assert.equal(
      shouldRestorePriorAfterCreateFailure({
        createFailed: true,
        priorClearedInBatch: true,
        restoreSnapshot: {
          bookingId: "old",
          expedienteId: "exp",
          sheetTitle: "03 AGOSTO ",
          sheetRow: 23,
          visibleBCD: ["n", "c", "a"],
          techOU: ["x", "old", "exp", "k", "crm", "t", "1"],
        },
      }),
      true,
    );
    assert.equal(
      shouldRestorePriorAfterCreateFailure({
        createFailed: true,
        priorClearedInBatch: false,
        restoreSnapshot: null,
      }),
      false,
    );
  });

  it("clave idempotente estable old>new", () => {
    assert.equal(
      rescheduleMoveIdempotencyKey({
        oldBookingId: "a",
        newBookingId: "b",
      }),
      "a>b:move:v1",
    );
  });
});
