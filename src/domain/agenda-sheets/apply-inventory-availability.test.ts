import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySheetInventoryToSlots } from "./apply-inventory-availability";
import type { AgendaBiometricosSlotAvailability } from "@/domain/agenda-biometricos/types";

const base: AgendaBiometricosSlotAvailability[] = [
  {
    date: "2026-07-31",
    locationId: "monterrey",
    time: "08:00",
    capacity: 7,
    bookedCount: 6,
    remaining: 1,
  },
  {
    date: "2026-07-31",
    locationId: "monterrey",
    time: "10:00",
    capacity: 6,
    bookedCount: 2,
    remaining: 4,
  },
];

describe("applySheetInventoryToSlots", () => {
  it("31 JULIO post-Gerardo: 08:00 y 10:00 llenos según inventario", () => {
    const { slots, blockedReason } = applySheetInventoryToSlots(
      base,
      {
        fresh: true,
        enforced: true,
        slots: [
          { slot_time: "08:00:00", available: 0 },
          { slot_time: "10:00:00", available: 0 },
        ],
      },
      "2026-07-31",
    );
    assert.equal(blockedReason, null);
    assert.equal(slots.find((s) => s.time === "08:00")?.remaining, 0);
    assert.equal(slots.find((s) => s.time === "10:00")?.remaining, 0);
  });

  it("stale → remaining 0 y mensaje", () => {
    const { slots, blockedReason } = applySheetInventoryToSlots(
      base,
      { fresh: false, enforced: true, slots: [] },
      "2026-07-31",
    );
    assert.equal(blockedReason, "Agenda temporalmente no disponible");
    assert.ok(slots.every((s) => s.remaining === 0));
  });

  it("Firmas Monterrey: UI refleja available del inventario", () => {
    const firmasSlots: AgendaBiometricosSlotAvailability[] = [
      {
        date: "2026-08-06",
        locationId: "monterrey",
        time: "08:30",
        capacity: 3,
        bookedCount: 0,
        remaining: 3,
      },
      {
        date: "2026-08-06",
        locationId: "monterrey",
        time: "09:00",
        capacity: 3,
        bookedCount: 0,
        remaining: 3,
      },
    ];
    const { slots, blockedReason, inventoryLabel } = applySheetInventoryToSlots(
      firmasSlots,
      {
        fresh: true,
        enforced: true,
        slots: [
          { slot_time: "08:30:00", available: 1 },
          { slot_time: "09:00:00", available: 3 },
        ],
      },
      "2026-08-06",
    );
    assert.equal(blockedReason, null);
    assert.equal(inventoryLabel, "Cupos sincronizados con Google Sheets");
    assert.equal(slots.find((s) => s.time === "08:30")?.remaining, 1);
    assert.equal(slots.find((s) => s.time === "09:00")?.remaining, 3);
  });
});
