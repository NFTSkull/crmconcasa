import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchBiometricSheetAvailability } from "./live-inventory-sync";

describe("fetchBiometricSheetAvailability", () => {
  it("usa el inventario RPC cuando live-sync responde stale", async () => {
    let rpcCalls = 0;
    const client = {
      functions: {
        invoke: async () => ({
          data: {
            ok: false,
            fresh: false,
            enforced: true,
            slots: [],
            code: "missing_sheet_for_date",
          },
          error: null,
        }),
      },
      rpc: async () => {
        rpcCalls += 1;
        return {
          data: {
            ok: true,
            fresh: true,
            enforced: true,
            daily_remaining: 7,
            slots: [
              { slot_time: "08:00:00", available: 1, physical_total: 8 },
              { slot_time: "10:00:00", available: 6, physical_total: 7 },
            ],
          },
          error: null,
        };
      },
    };

    const result = await fetchBiometricSheetAvailability(client, {
      bookingDate: "2026-09-18",
      locationId: "monterrey",
    });

    assert.equal(rpcCalls, 1);
    assert.equal(result.fresh, true);
    assert.equal(result.daily_remaining, 7);
    assert.deepEqual(
      result.slots?.map((slot) => slot.available),
      [1, 6],
    );
  });

  it("prefiere live-sync fresco y no hace RPC adicional", async () => {
    let rpcCalls = 0;
    const client = {
      functions: {
        invoke: async () => ({
          data: {
            ok: true,
            fresh: true,
            enforced: true,
            daily_remaining: 7,
            slots: [{ slot_time: "10:00:00", available: 6, physical_total: 7 }],
          },
          error: null,
        }),
      },
      rpc: async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    };

    const result = await fetchBiometricSheetAvailability(client, {
      bookingDate: "2026-09-18",
      locationId: "monterrey",
    });

    assert.equal(rpcCalls, 0);
    assert.equal(result.fresh, true);
    assert.equal(result.slots?.[0]?.available, 6);
  });
});
