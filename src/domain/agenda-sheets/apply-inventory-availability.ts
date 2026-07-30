import type { AgendaBiometricosSlotAvailability } from "@/domain/agenda-biometricos/types";
import {
  effectiveSheetAwareRemaining,
  isInventoryEnforcedDate,
} from "@/domain/agenda-sheets/sheet-inventory";

export type InventoryAvailabilitySlot = Readonly<{
  slot_time: string;
  available: number;
  physical_total?: number;
}>;

export type InventoryAvailabilityResponse = Readonly<{
  ok?: boolean;
  fresh: boolean;
  enforced: boolean;
  slots?: readonly InventoryAvailabilitySlot[];
}>;

/** Aplica cupo físico del inventario al remaining de UI. */
export function applySheetInventoryToSlots(
  slots: readonly AgendaBiometricosSlotAvailability[],
  inventory: InventoryAvailabilityResponse | null,
  bookingDate: string,
): {
  slots: AgendaBiometricosSlotAvailability[];
  blockedReason: string | null;
  inventoryLabel: string | null;
} {
  const enforced =
    inventory?.enforced === true || isInventoryEnforcedDate(bookingDate);
  if (!enforced) {
    return { slots: [...slots], blockedReason: null, inventoryLabel: null };
  }
  if (!inventory || inventory.fresh !== true) {
    return {
      slots: slots.map((s) => ({ ...s, remaining: 0 })),
      blockedReason: "Agenda temporalmente no disponible",
      inventoryLabel: "Cupos sincronizados con Google Sheets",
    };
  }
  const byTime = new Map<string, number>();
  for (const s of inventory.slots ?? []) {
    const t = String(s.slot_time).slice(0, 5);
    byTime.set(t, Number(s.available) || 0);
  }
  const next = slots.map((slot) => {
    const invAvail = byTime.has(slot.time) ? (byTime.get(slot.time) as number) : 0;
    const { remaining } = effectiveSheetAwareRemaining({
      configRemaining: slot.remaining,
      inventoryAvailable: invAvail,
      inventoryFresh: true,
      inventoryEnforced: true,
    });
    return { ...slot, remaining };
  });
  return {
    slots: next,
    blockedReason: null,
    inventoryLabel: "Cupos sincronizados con Google Sheets",
  };
}
