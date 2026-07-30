import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySheetInventoryToSlots,
  type InventoryAvailabilityResponse,
} from "./apply-inventory-availability";
import type { AgendaBiometricosSlotAvailability } from "@/domain/agenda-biometricos/types";

describe("applySheetInventoryToSlots — discrepancia Horario lleno", () => {
  const base10: AgendaBiometricosSlotAvailability = {
    date: "2026-08-06",
    locationId: "monterrey",
    time: "10:00",
    capacity: 8,
    bookedCount: 0,
    remaining: 8,
  };
  const base08: AgendaBiometricosSlotAvailability = {
    date: "2026-08-06",
    locationId: "monterrey",
    time: "08:00",
    capacity: 7,
    bookedCount: 2,
    remaining: 5,
  };

  it("RPC available=1 en 10:00 → remaining=1 (NO Horario lleno)", () => {
    const inventory: InventoryAvailabilityResponse = {
      ok: true,
      fresh: true,
      enforced: true,
      slots: [
        { slot_time: "08:00:00", available: 7 },
        { slot_time: "10:00:00", available: 1 },
        { slot_time: "11:00:00", available: 6 },
      ],
    };
    const { slots } = applySheetInventoryToSlots([base08, base10], inventory, "2026-08-06");
    const s10 = slots.find((s) => s.time === "10:00");
    assert.equal(s10?.remaining, 1);
    assert.ok((s10?.remaining ?? 0) > 0, "no debe renderizar Horario lleno");
    assert.equal(slots.find((s) => s.time === "08:00")?.remaining, 5);
  });

  it("sin clave 10:00 en inventario (solo 11:00 lógico) → remaining=0 = Horario lleno", () => {
    const inventory: InventoryAvailabilityResponse = {
      ok: true,
      fresh: true,
      enforced: true,
      slots: [
        { slot_time: "08:00:00", available: 7 },
        { slot_time: "11:00:00", available: 6 },
      ],
    };
    const { slots } = applySheetInventoryToSlots([base08, base10], inventory, "2026-08-06");
    assert.equal(slots.find((s) => s.time === "10:00")?.remaining, 0);
  });

  it("fresh=false fuerza remaining=0 en todos", () => {
    const inventory: InventoryAvailabilityResponse = {
      fresh: false,
      enforced: true,
      slots: [{ slot_time: "10:00:00", available: 7 }],
    };
    const { slots, blockedReason } = applySheetInventoryToSlots(
      [base10],
      inventory,
      "2026-08-06",
    );
    assert.equal(slots[0]?.remaining, 0);
    assert.ok(blockedReason);
  });
});
