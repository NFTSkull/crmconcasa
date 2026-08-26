import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBiometricBookGateAttempt } from "./daily-capacity";
import { invokeAgendaSheetLiveSync } from "./live-inventory-sync";

const BASE = {
  kind: "biometricos",
  locationId: "monterrey",
  bookingDate: "2026-09-04",
} as const;

async function simulateBookClick(input: {
  gate: Awaited<ReturnType<typeof invokeAgendaSheetLiveSync>>;
  repo: { bookBiometricos: () => void };
}): Promise<{ bookGateError: string | null; rpcCalls: number }> {
  const attempt = resolveBiometricBookGateAttempt({ ...BASE, gate: input.gate });
  if (!attempt.mayCallBookBiometricos) {
    return { bookGateError: attempt.bookGateError, rpcCalls: 0 };
  }
  let rpcCalls = 0;
  input.repo.bookBiometricos();
  rpcCalls += 1;
  return { bookGateError: null, rpcCalls };
}

describe("book_gate hard flow — invoke + booking RPC", () => {
  it("A) invoke null + fallback fresh: bloqueado, 0 RPC", async () => {
    const gate = await invokeAgendaSheetLiveSync(
      {
        functions: {
          invoke: async () => ({ data: null, error: { message: "Failed to fetch" } }),
        },
      },
      { bookingDate: BASE.bookingDate, kind: "biometricos", locationId: "monterrey", mode: "book_gate", slotTime: "10:00" },
    );
    assert.equal(gate, null);
    let calls = 0;
    const out = await simulateBookClick({
      gate,
      repo: { bookBiometricos: () => { calls += 1; } },
    });
    assert.ok(out.bookGateError);
    assert.equal(calls, 0);
    assert.equal(out.rpcCalls, 0);
  });

  it("B) fresh=false: bloqueado, 0 RPC", async () => {
    let calls = 0;
    const out = await simulateBookClick({
      gate: { fresh: false, canBook: true, enforced: true, slots: [] },
      repo: { bookBiometricos: () => { calls += 1; } },
    });
    assert.ok(out.bookGateError);
    assert.equal(calls, 0);
  });

  it("C) fresh=true canBook=false: bloqueado, 0 RPC", async () => {
    let calls = 0;
    const out = await simulateBookClick({
      gate: { fresh: true, canBook: false, enforced: true, gateMessage: "Sin cupo", slots: [] },
      repo: { bookBiometricos: () => { calls += 1; } },
    });
    assert.equal(out.bookGateError, "Sin cupo");
    assert.equal(calls, 0);
  });

  it("D) fresh=true canBook=true: bookBiometricos exactamente 1 vez", async () => {
    const gate = await invokeAgendaSheetLiveSync(
      {
        functions: {
          invoke: async () => ({
            data: {
              fresh: true,
              canBook: true,
              enforced: true,
              slots: [{ slot_time: "10:00", available: 8, physical_total: 8 }],
            },
            error: null,
          }),
        },
      },
      { bookingDate: BASE.bookingDate, kind: "biometricos", locationId: "monterrey", mode: "book_gate", slotTime: "10:00" },
    );
    assert.ok(gate);
    assert.equal(gate.fresh, true);
    assert.equal(gate.canBook, true);
    let calls = 0;
    const out = await simulateBookClick({
      gate,
      repo: { bookBiometricos: () => { calls += 1; } },
    });
    assert.equal(out.bookGateError, null);
    assert.equal(calls, 1);
    assert.equal(out.rpcCalls, 1);
  });
});
