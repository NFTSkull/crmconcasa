/**
 * Hard-cap diario Biométricos Monterrey.
 * Google Sheets = ocupación física; NO define capacidad.
 * 1 persona = 1 lugar. CRM booked + externos Sheet sin doble conteo.
 */

export const BIOMETRICOS_MONTERREY_DAILY_CAPACITY = 15 as const;

export const LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE =
  "No pudimos verificar el cupo en Google Sheets. Intenta de nuevo en unos segundos.";

export type DailyCapacityKind = "biometricos" | "firmas" | "inscripcion";
export type DailyCapacityLocation = "monterrey" | "apodaca" | string;

export type DailyOccupancyInventoryRow = Readonly<{
  status: string;
  bookingId?: string | null;
}>;

export type DailyOccupancyBooking = Readonly<{
  id: string;
  status: string;
}>;

/** Fuente única: null = sin tope diario (Firmas / Inscripción / Apodaca). */
export function agendaDailyCapacity(
  kind: DailyCapacityKind | string,
  locationId: DailyCapacityLocation,
): number | null {
  if (kind === "biometricos" && locationId === "monterrey") {
    return BIOMETRICOS_MONTERREY_DAILY_CAPACITY;
  }
  return null;
}

function isBooked(status: string | null | undefined): boolean {
  return String(status ?? "").toLowerCase() === "booked";
}

/**
 * TOTAL_ACTIVE_OCCUPANCY:
 *   CRM bookings status=booked
 * + inventory occupied_external / conflict que NO son esos mismos bookings
 * + claimed/linked huérfanos (sin booking booked) — fail-closed, no regalan cupo
 * linked/claimed con booking CRM booked → 0 extra (anti doble conteo)
 * available / disabled / history → 0
 */
export function agendaDailyActiveOccupancy(input: {
  bookings: readonly DailyOccupancyBooking[];
  inventory: readonly DailyOccupancyInventoryRow[];
}): number {
  const crmIds = new Set(
    input.bookings.filter((b) => isBooked(b.status)).map((b) => b.id),
  );
  const crmCount = crmIds.size;

  let sheetOnly = 0;
  let orphanClaim = 0;
  for (const row of input.inventory) {
    const st = String(row.status ?? "");
    const bid = row.bookingId ?? null;
    const tiedToCrm = Boolean(bid && crmIds.has(bid));

    if (st === "available" || st === "disabled") continue;

    if (st === "linked" || st === "claimed") {
      if (!tiedToCrm) orphanClaim += 1;
      continue;
    }

    if (st === "occupied_external" || st === "conflict") {
      if (!tiedToCrm) sheetOnly += 1;
      continue;
    }

    // Estado desconocido: no regala cupo.
    if (!tiedToCrm) sheetOnly += 1;
  }

  return crmCount + sheetOnly + orphanClaim;
}

export function agendaDailyRemaining(
  kind: DailyCapacityKind | string,
  locationId: DailyCapacityLocation,
  occupancy: number,
): { capacity: number | null; occupancy: number; remaining: number | null; overcapacity: boolean } {
  const capacity = agendaDailyCapacity(kind, locationId);
  if (capacity == null) {
    return { capacity: null, occupancy, remaining: null, overcapacity: false };
  }
  const overcapacity = occupancy > capacity;
  return {
    capacity,
    occupancy,
    remaining: overcapacity ? 0 : Math.max(0, capacity - occupancy),
    overcapacity,
  };
}

export function effectiveSlotRemainingWithDaily(params: {
  perHourRemaining: number;
  physicalAvailable: number;
  dailyRemaining: number | null;
}): number {
  const hour = Math.max(0, Math.trunc(params.perHourRemaining));
  const physical = Math.max(0, Math.trunc(params.physicalAvailable));
  const base = Math.min(hour, physical);
  if (params.dailyRemaining == null) return base;
  return Math.min(base, Math.max(0, Math.trunc(params.dailyRemaining)));
}

export function isInventoryLiveSyncRequired(input: {
  kind: string;
  locationId: string;
  bookingDate: string;
}): boolean {
  if (input.kind !== "biometricos") return false;
  if (input.locationId !== "monterrey" && input.locationId !== "apodaca") {
    return false;
  }
  return input.bookingDate >= "2026-07-30";
}

export function shouldBlockBookWithoutLiveSync(input: {
  kind: string;
  locationId: string;
  bookingDate: string;
  gate: { fresh?: boolean; canBook?: boolean } | null;
}): { block: boolean; message: string | null } {
  if (!isInventoryLiveSyncRequired(input)) {
    return { block: false, message: null };
  }
  if (!input.gate) {
    return { block: true, message: LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE };
  }
  if (input.gate.fresh !== true) {
    return { block: true, message: LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE };
  }
  if (input.gate.canBook === false) {
    return { block: true, message: null };
  }
  return { block: false, message: null };
}
