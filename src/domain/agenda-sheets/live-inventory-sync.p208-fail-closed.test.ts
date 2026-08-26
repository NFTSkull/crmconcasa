import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldBlockBookWithoutLiveSync,
  LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE,
} from "./daily-capacity";
import { invokeAgendaSheetLiveSync } from "./live-inventory-sync";

const BASE = {
  kind: "biometricos",
  locationId: "monterrey",
  bookingDate: "2026-08-24",
} as const;

/** Mismo orden que AgendaBiometricosSupabaseCard: gate fail-closed antes de repo.bookBiometricos. */
async function attemptBookAfterLiveGate(input: {
  gate: { fresh?: boolean; canBook?: boolean } | null;
  repo: { bookBiometricos: (...args: unknown[]) => Promise<unknown> | unknown };
}): Promise<"blocked" | "booked"> {
  const blocked = shouldBlockBookWithoutLiveSync({
    ...BASE,
    gate: input.gate,
  });
  if (blocked.block) return "blocked";
  if (input.gate?.canBook === false) return "blocked";
  await input.repo.bookBiometricos({
    expedienteId: "exp-spy",
    scheduledAt: "2026-08-24T15:00:00.000Z",
    locationId: "monterrey",
  });
  return "booked";
}

describe("P208 FE fail-closed live-sync → 0 book RPC", () => {
  it("null gate: book 0 veces", async () => {
    let calls = 0;
    const result = await attemptBookAfterLiveGate({
      gate: null,
      repo: {
        bookBiometricos: () => {
          calls += 1;
        },
      },
    });
    assert.equal(result, "blocked");
    assert.equal(calls, 0);
  });

  it("fresh=false: book 0 veces", async () => {
    let calls = 0;
    const result = await attemptBookAfterLiveGate({
      gate: { fresh: false, canBook: true },
      repo: {
        bookBiometricos: () => {
          calls += 1;
        },
      },
    });
    assert.equal(result, "blocked");
    assert.equal(calls, 0);
  });

  it("invoke network error → null → book 0 veces", async () => {
    const out = await invokeAgendaSheetLiveSync(
      {
        functions: {
          invoke: async () => ({ data: null, error: { message: "network" } }),
        },
      },
      { bookingDate: "2026-08-24", kind: "biometricos", locationId: "monterrey" },
    );
    assert.equal(out, null);
    let calls = 0;
    const result = await attemptBookAfterLiveGate({
      gate: out,
      repo: {
        bookBiometricos: () => {
          calls += 1;
        },
      },
    });
    assert.equal(result, "blocked");
    assert.equal(calls, 0);
    assert.match(LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE, /verificar el cupo/);
  });

  it("invoke timeout/error object → null → book 0", async () => {
    const out = await invokeAgendaSheetLiveSync(
      {
        functions: {
          invoke: async () => ({
            data: null,
            error: { message: "FunctionsHttpError: timeout" },
          }),
        },
      },
      { bookingDate: "2026-08-24", kind: "biometricos", locationId: "monterrey" },
    );
    assert.equal(out, null);
    let calls = 0;
    await attemptBookAfterLiveGate({
      gate: out,
      repo: {
        bookBiometricos: () => {
          calls += 1;
        },
      },
    });
    assert.equal(calls, 0);
  });

  it("invoke 404 body → fresh=false (no null) → book 0", async () => {
    const out = await invokeAgendaSheetLiveSync(
      {
        functions: {
          invoke: async () =>
            ({
              data: null,
              error: {
                message: "Edge Function returned a non-2xx status code",
                context: {
                  json: async () => ({
                    ok: false,
                    code: "missing_sheet_for_date",
                    fresh: false,
                    enforced: true,
                    slots: [],
                  }),
                },
              },
            }) as { data: unknown; error: { message?: string; context?: Response } | null },
        },
      },
      { bookingDate: "2026-11-01", kind: "biometricos", locationId: "monterrey" },
    );
    assert.ok(out);
    assert.equal(out?.fresh, false);
    assert.equal(out?.code, "missing_sheet_for_date");
    let calls = 0;
    const result = await attemptBookAfterLiveGate({
      gate: out,
      repo: {
        bookBiometricos: () => {
          calls += 1;
        },
      },
    });
    assert.equal(result, "blocked");
    assert.equal(calls, 0);
  });

  it("missing_sheet fresh=false mensaje distinto a unverified", () => {
    const blocked = shouldBlockBookWithoutLiveSync({
      kind: "biometricos",
      locationId: "monterrey",
      bookingDate: "2026-11-01",
      gate: { fresh: false, code: "missing_sheet_for_date" },
    });
    assert.equal(blocked.block, true);
    assert.doesNotMatch(blocked.message ?? "", /verificar el cupo/i);
  });

  it("malformed payload (sin fresh ni code) → null → book 0", async () => {
    const out = await invokeAgendaSheetLiveSync(
      {
        functions: {
          invoke: async () => ({ data: { ok: true, slots: [] }, error: null }),
        },
      },
      { bookingDate: "2026-08-24", kind: "biometricos", locationId: "monterrey" },
    );
    assert.equal(out, null);
    let calls = 0;
    await attemptBookAfterLiveGate({
      gate: out,
      repo: {
        bookBiometricos: () => {
          calls += 1;
        },
      },
    });
    assert.equal(calls, 0);
  });

  it("fresh+canBook true: book 1 vez", async () => {
    let calls = 0;
    const result = await attemptBookAfterLiveGate({
      gate: { fresh: true, canBook: true },
      repo: {
        bookBiometricos: () => {
          calls += 1;
        },
      },
    });
    assert.equal(result, "booked");
    assert.equal(calls, 1);
  });
});
