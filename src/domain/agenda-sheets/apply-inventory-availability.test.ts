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

  it("inventario con 09:30 omitido en config → se agrega con capacidad física 3", () => {
    const inventory: InventoryAvailabilityResponse = {
      ok: true,
      fresh: true,
      enforced: true,
      slots: [
        { slot_time: "08:30:00", available: 0, physical_total: 3 },
        { slot_time: "09:00:00", available: 0, physical_total: 3 },
        { slot_time: "09:30:00", available: 3, physical_total: 3 },
        { slot_time: "10:00:00", available: 3, physical_total: 3 },
      ],
    };
    // Config solo ofreció 08:30/09:00 (10:00 cerrado en config → ausente)
    const fromConfig: AgendaBiometricosSlotAvailability[] = [
      {
        date: "2026-08-07",
        locationId: "monterrey",
        time: "08:30",
        capacity: 5,
        bookedCount: 3,
        remaining: 2,
      },
      {
        date: "2026-08-07",
        locationId: "monterrey",
        time: "09:00",
        capacity: 5,
        bookedCount: 3,
        remaining: 2,
      },
    ];
    const { slots } = applySheetInventoryToSlots(
      fromConfig,
      inventory,
      "2026-08-07",
    );
    const s930 = slots.find((s) => s.time === "09:30");
    const s1000 = slots.find((s) => s.time === "10:00");
    assert.ok(s930, "09:30 debe aparecer desde inventario");
    assert.equal(s930?.capacity, 3);
    assert.equal(s930?.remaining, 3);
    assert.ok(s1000, "10:00 vacío en Sheet debe aparecer aunque config lo omitió");
    assert.equal(s1000?.remaining, 3);
    assert.equal(slots.find((s) => s.time === "08:30")?.remaining, 0);
  });
});
