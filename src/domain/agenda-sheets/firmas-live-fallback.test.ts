import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { invokeAgendaSheetLiveSync } from "./live-inventory-sync";

function clientWithPayload(payload: unknown) {
  return {
    functions: {
      invoke: async () => ({ data: payload, error: null }),
    },
  };
}

describe("Firmas live-sync availability fallback", () => {
  it("availability stale/error → null para permitir fallback al RPC SQL", async () => {
    const result = await invokeAgendaSheetLiveSync(
      clientWithPayload({
        fresh: false,
        enforced: true,
        slots: [],
        code: "google_sheets_meta_failed",
      }),
      {
        bookingDate: "2026-09-18",
        kind: "firmas",
        locationId: "monterrey",
        mode: "availability",
      },
    );

    assert.equal(result, null);
  });

  it("book_gate stale/error conserva fail-closed", async () => {
    const result = await invokeAgendaSheetLiveSync(
      clientWithPayload({
        fresh: false,
        enforced: true,
        slots: [],
        canBook: false,
        code: "google_sheets_meta_failed",
      }),
      {
        bookingDate: "2026-09-18",
        kind: "firmas",
        locationId: "monterrey",
        mode: "book_gate",
        slotTime: "09:30",
      },
    );

    assert.equal(result?.fresh, false);
    assert.equal(result?.canBook, false);
    assert.equal(result?.code, "google_sheets_meta_failed");
  });

  it("biométricos conserva su semántica existente", async () => {
    const result = await invokeAgendaSheetLiveSync(
      clientWithPayload({
        fresh: false,
        enforced: true,
        slots: [],
        code: "google_sheets_meta_failed",
      }),
      {
        bookingDate: "2026-09-18",
        kind: "biometricos",
        locationId: "monterrey",
        mode: "availability",
      },
    );

    assert.equal(result?.fresh, false);
    assert.equal(result?.code, "google_sheets_meta_failed");
  });
});
