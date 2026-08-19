import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapAgendaBookingSheetSyncRpc } from "./booking-sheet-sync-status";

describe("mapAgendaBookingSheetSyncRpc", () => {
  it("mapea SYNCED sin payload/outbox crudo", () => {
    const m = mapAgendaBookingSheetSyncRpc({
      ok: true,
      booking_id: "4864ef4d-813a-42b4-808c-93487b85c384",
      sync_status: "SYNCED",
      last_synced_at: "2026-08-19T19:26:00Z",
      sync_pending: false,
      sync_error: false,
    });
    assert.equal(m?.syncStatus, "SYNCED");
    assert.equal(m?.syncPending, false);
    assert.equal(m?.syncError, false);
  });

  it("C14: PENDING no invalida el booking", () => {
    const m = mapAgendaBookingSheetSyncRpc({
      ok: true,
      booking_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sync_status: "PENDING",
      last_synced_at: null,
      sync_pending: true,
      sync_error: false,
    });
    assert.equal(m?.syncStatus, "PENDING");
    assert.equal(m?.syncPending, true);
    assert.equal(m?.syncError, false);
  });

  it("FORBIDDEN / forma inválida → null", () => {
    assert.equal(mapAgendaBookingSheetSyncRpc({ ok: false, error: "FORBIDDEN" }), null);
    assert.equal(mapAgendaBookingSheetSyncRpc({ sync_status: "SYNCED" }), null);
    assert.equal(mapAgendaBookingSheetSyncRpc(null), null);
  });
});
