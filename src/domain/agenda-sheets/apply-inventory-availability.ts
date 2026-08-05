import type {
  AgendaBiometricosSlotAvailability,
  HhmmTime,
  YmdDate,
} from "@/domain/agenda-biometricos/types";
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

function normalizeInvTime(raw: string): HhmmTime | null {
  const t = String(raw ?? "").trim().slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  return t as HhmmTime;
}

/**
 * Aplica cupo físico del inventario al remaining de UI.
 * Cuando el inventario está enforced+fresh:
 * - ajusta remaining de slots ya ofrecidos por config;
 * - agrega horarios presentes en Sheet que la config omitió (p.ej. 09:30).
 * Capacidad de un horario solo-inventario = physical_total (filas físicas).
 */
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

  const byTime = new Map<
    HhmmTime,
    { available: number; physicalTotal: number }
  >();
  for (const s of inventory.slots ?? []) {
    const t = normalizeInvTime(s.slot_time);
    if (!t) continue;
    const available = Math.max(0, Number(s.available) || 0);
    const physicalTotal = Math.max(
      available,
      Number(s.physical_total) || 0,
      available,
    );
    byTime.set(t, { available, physicalTotal: physicalTotal || available });
  }

  const locationId = slots[0]?.locationId ?? "monterrey";
  const next: AgendaBiometricosSlotAvailability[] = slots.map((slot) => {
    const inv = byTime.get(slot.time);
    const invAvail = inv?.available ?? 0;
    const { remaining } = effectiveSheetAwareRemaining({
      configRemaining: slot.remaining,
      inventoryAvailable: invAvail,
      inventoryFresh: true,
      inventoryEnforced: true,
    });
    const capacity = inv?.physicalTotal
      ? Math.max(slot.capacity, inv.physicalTotal)
      : slot.capacity;
    return {
      ...slot,
      capacity,
      remaining,
      bookedCount: Math.max(0, capacity - remaining),
    };
  });

  const known = new Set<HhmmTime>(next.map((s) => s.time));
  for (const [time, inv] of byTime) {
    if (known.has(time)) continue;
    // Solo ofrecer horarios con filas físicas reales en Sheet.
    if (inv.physicalTotal < 1 && inv.available < 1) continue;
    const capacity = Math.max(inv.physicalTotal, inv.available);
    const remaining = inv.available;
    next.push({
      date: bookingDate as YmdDate,
      locationId,
      time,
      capacity,
      bookedCount: Math.max(0, capacity - remaining),
      remaining,
    });
  }

  next.sort((a, b) => a.time.localeCompare(b.time));

  return {
    slots: next,
    blockedReason: null,
    inventoryLabel: "Cupos sincronizados con Google Sheets",
  };
}
