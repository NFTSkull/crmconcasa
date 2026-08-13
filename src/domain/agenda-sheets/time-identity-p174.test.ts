import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifySheetTimeIdentity,
  extractSheetTimeFromSlotKey,
  shouldSkipApplyForTimeIdentity,
  SKIPPED_TIME_IDENTITY_CONFLICT,
} from "./time-identity";
import { classifyMissingInventoryLink } from "./missing-links";
import {
  APPLY_BUSINESS_OUTCOMES,
  localSkipApplyForTimeIdentity,
} from "./operational-apply-rpc";
import { applySheetInventoryToSlots } from "./apply-inventory-availability";
import { resolveLogicalStartTime } from "./time-aliases";
import {
  buildReplacementSlotVisibleRow,
} from "./rescheduled-history";

describe("P174 time-identity", () => {
  it("extractSheetTimeFromSlotKey lee sheet=HH:mm", () => {
    assert.equal(
      extractSheetTimeFromSlotKey(
        "biometricos|2026-08-18|10:00|monterrey|sheet=11:00|sheetId=1|row=33",
      ),
      "11:00",
    );
    assert.equal(extractSheetTimeFromSlotKey(""), null);
    assert.equal(extractSheetTimeFromSlotKey("no-sheet-frag"), null);
  });

  it("A=10:00 y R sheet=11:00 → conflicto", () => {
    const v = classifySheetTimeIdentity({
      visibleSheetTime: "10:00",
      liveSlotKey:
        "biometricos|2026-08-18|10:00|monterrey|sheet=11:00|sheetId=1|row=33",
    });
    assert.equal(v.class, "TIME_IDENTITY_CONFLICT");
    assert.equal(v.conflict, true);
    assert.equal(
      shouldSkipApplyForTimeIdentity({
        visibleSheetTime: "10:00",
        liveSlotKey:
          "biometricos|2026-08-18|10:00|monterrey|sheet=11:00|sheetId=1|row=33",
      }),
      true,
    );
  });

  it("A=11:00 y R sheet=11:00 → OK (alias lógico no interviene)", () => {
    const v = classifySheetTimeIdentity({
      visibleSheetTime: "11:00",
      liveSlotKey:
        "biometricos|2026-08-18|10:00|monterrey|sheet=11:00|sheetId=1|row=33",
    });
    assert.equal(v.class, "OK");
    assert.equal(v.conflict, false);
  });

  it("sin R sheet= → no conflicto (solo detectar missing)", () => {
    const v = classifySheetTimeIdentity({
      visibleSheetTime: "10:00",
      liveSlotKey: "legacy-key-without-sheet",
    });
    assert.equal(v.class, "MISSING_SLOT_KEY_SHEET");
    assert.equal(v.conflict, false);
  });

  it("localSkipApplyForTimeIdentity → SKIPPED_TIME_IDENTITY_CONFLICT", () => {
    assert.ok(
      APPLY_BUSINESS_OUTCOMES.includes(SKIPPED_TIME_IDENTITY_CONFLICT),
    );
    const skip = localSkipApplyForTimeIdentity({
      visibleSheetTime: "10:00",
      liveSlotKey: "x|sheet=11:00|row=1",
    });
    assert.ok(skip);
    assert.equal(skip!.outcome, SKIPPED_TIME_IDENTITY_CONFLICT);
    assert.equal(skip!.mutated, false);
    assert.equal(skip!.skippedRpc, true);
    assert.equal(
      localSkipApplyForTimeIdentity({
        visibleSheetTime: "10:00",
        liveSlotKey: "x|sheet=10:00|row=1",
      }),
      null,
    );
  });
});

describe("P174 missing-links classifier (RO)", () => {
  it("REPAIRABLE_BY_PQ cuando booking+expediente UUID ok", () => {
    const v = classifyMissingInventoryLink({
      inventoryBookingId: "b1",
      inventoryExpedienteId: "e1",
      hasActiveLink: false,
      bookingExists: true,
      bookingExpedienteId: "e1",
    });
    assert.equal(v.class, "REPAIRABLE_BY_PQ");
    assert.equal(v.repairable, true);
  });

  it("NOT_REPAIRABLE si expediente mismatch", () => {
    const v = classifyMissingInventoryLink({
      inventoryBookingId: "b1",
      inventoryExpedienteId: "e1",
      hasActiveLink: false,
      bookingExists: true,
      bookingExpedienteId: "e2",
    });
    assert.equal(v.class, "NOT_REPAIRABLE_EXPEDIENTE_MISMATCH");
    assert.equal(v.repairable, false);
  });

  it("HAS_ACTIVE_LINK no reparable", () => {
    const v = classifyMissingInventoryLink({
      inventoryBookingId: "b1",
      inventoryExpedienteId: "e1",
      hasActiveLink: true,
      bookingExists: true,
      bookingExpedienteId: "e1",
    });
    assert.equal(v.class, "HAS_ACTIVE_LINK");
  });
});

describe("P174 aliases + availability unchanged", () => {
  it("aliases 08:30→08:00 y 11:00→10:00 intactos", () => {
    const aliases = [
      {
        locationId: "monterrey",
        kind: "biometricos",
        logicalStartTime: "08:00",
        sheetStartTime: "08:30",
      },
      {
        locationId: "monterrey",
        kind: "biometricos",
        logicalStartTime: "10:00",
        sheetStartTime: "10:00",
      },
      {
        locationId: "monterrey",
        kind: "biometricos",
        logicalStartTime: "10:00",
        sheetStartTime: "11:00",
      },
    ];
    assert.equal(
      resolveLogicalStartTime({
        aliases,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "08:30",
      }),
      "08:00",
    );
    assert.equal(
      resolveLogicalStartTime({
        aliases,
        locationId: "monterrey",
        kind: "biometricos",
        sheetStartTime: "11:00",
      }),
      "10:00",
    );
  });

  it("applySheetInventoryToSlots sigue agrupando por slot_time lógico", () => {
    const { slots } = applySheetInventoryToSlots(
      [
        {
          date: "2026-08-18",
          locationId: "monterrey",
          time: "10:00",
          capacity: 5,
          bookedCount: 0,
          remaining: 5,
        },
      ],
      {
        fresh: true,
        enforced: true,
        slots: [
          { slot_time: "10:00", available: 2, physical_total: 5 },
        ],
      },
      "2026-08-18",
    );
    assert.equal(slots[0]?.time, "10:00");
    assert.equal(slots[0]?.remaining, 2);
  });
});

describe("P174 P121 replacement A = historical A exacta", () => {
  it("no convierte 11:00→10:00 ni 08:30→08:00", () => {
    assert.deepEqual(buildReplacementSlotVisibleRow("11:00"), [
      "11:00",
      "",
      "",
      "",
    ]);
    assert.deepEqual(buildReplacementSlotVisibleRow("08:30"), [
      "08:30",
      "",
      "",
      "",
    ]);
    assert.deepEqual(buildReplacementSlotVisibleRow("10:00"), [
      "10:00",
      "",
      "",
      "",
    ]);
  });

  it("worker escribe A replacement desde inspection.hora (no booking_time)", () => {
    const worker = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/agenda-sheet-sync-worker/index.ts",
      ),
      "utf8",
    );
    const start = worker.indexOf("// Replacement: misma hora");
    assert.ok(start > 0);
    const block = worker.slice(start, start + 900);
    assert.match(block, /inspection\.hora/);
    assert.doesNotMatch(block, /booking_time/);
    assert.doesNotMatch(block, /resolveLogicalStartTime/);
    assert.doesNotMatch(block, /resolvePhysicalSheetTimes/);
  });
});

describe("P174 webhook/reconcile A read-only contracts", () => {
  it("webhook: occupied_slot_time_changed no escribe A ni booking_time", () => {
    const webhook = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/agenda-sheet-webhook/index.ts",
      ),
      "utf8",
    );
    const idx = webhook.indexOf("occupied_slot_time_changed");
    assert.ok(idx > 0);
    const block = webhook.slice(idx - 200, idx + 1200);
    assert.match(block, /action_log/);
    assert.doesNotMatch(block, /\.from\("agenda_bookings"\)[\s\S]{0,80}\.update/);
    assert.doesNotMatch(block, /batchUpdateValues/);
    assert.doesNotMatch(block, /!A\$\{/);
  });

  it("reconcile no batchUpdateValues / no escribe A", () => {
    const reconcile = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/agenda-sheet-reconcile/index.ts",
      ),
      "utf8",
    );
    assert.doesNotMatch(reconcile, /batchUpdateValues/);
    assert.doesNotMatch(reconcile, /batchClear/);
    assert.match(reconcile, /visibleSheetTime/);
    assert.match(reconcile, /liveSlotKey/);
    assert.match(reconcile, /applyOperationalResult/);
  });

  it("Edge apply incluye SKIPPED_TIME_IDENTITY_CONFLICT", () => {
    const apply = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/_shared/agenda-sheets/apply-operational-result.ts",
      ),
      "utf8",
    );
    assert.match(apply, /SKIPPED_TIME_IDENTITY_CONFLICT/);
    assert.match(apply, /shouldSkipApplyForTimeIdentity/);
  });
});
