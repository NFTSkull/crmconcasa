/**
 * Hard-cap diario Biométricos Monterrey.
 * Google Sheets = ocupación física; NO define capacidad.
 * 1 persona = 1 lugar. CRM booked + externos Sheet sin doble conteo.
 */

import { BOOK_SLOT_JUST_TAKEN_MESSAGE } from "./manual-occupancy";
import {
  FIRMAS_DAILY_CAP_CONTRACT_DEFAULT,
  type FirmasDailyCapContractState,
} from "./firmas-bookable-slots";

export const BIOMETRICOS_MONTERREY_DAILY_CAPACITY = 15 as const;
export const FIRMAS_DAILY_CAPACITY_PER_SEDE = 15 as const;

export const LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE =
  "No pudimos verificar el cupo en Google Sheets. Intenta de nuevo en unos segundos.";

export const LIVE_SYNC_SHEET_TAB_MISSING_MESSAGE =
  "No hay agenda en Google Sheets para esta fecha. Elige otra fecha disponible.";

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

/** Fuente única: null = sin tope diario.
 * Firmas: solo con contrato P212 activo (default OFF → null, legacy pre-P212).
 */
export function agendaDailyCapacity(
  kind: DailyCapacityKind | string,
  locationId: DailyCapacityLocation,
  contract: FirmasDailyCapContractState = FIRMAS_DAILY_CAP_CONTRACT_DEFAULT,
): number | null {
  if (kind === "biometricos" && locationId === "monterrey") {
    return BIOMETRICOS_MONTERREY_DAILY_CAPACITY;
  }
  if (kind === "firmas" && (locationId === "monterrey" || locationId === "apodaca")) {
    // Sin bookingDate aquí: enabled=false → null; enabled=true sin from → 15.
    if (!contract.enabled) return null;
    return FIRMAS_DAILY_CAPACITY_PER_SEDE;
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
  contract: FirmasDailyCapContractState = FIRMAS_DAILY_CAP_CONTRACT_DEFAULT,
): { capacity: number | null; occupancy: number; remaining: number | null; overcapacity: boolean } {
  const capacity = agendaDailyCapacity(kind, locationId, contract);
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
  if (input.locationId !== "monterrey" && input.locationId !== "apodaca") {
    return false;
  }
  if (input.bookingDate < "2026-07-30") return false;
  if (input.kind === "biometricos") return true;
  // Firmas: live-sync obligatorio en era inventario (fail-closed físico).
  // Sin cutover hardcode 2026-09-01 — el contrato SQL se activa por flag explícito.
  if (input.kind === "firmas") return true;
  return false;
}

export function shouldBlockBookWithoutLiveSync(input: {
  kind: string;
  locationId: string;
  bookingDate: string;
  gate: {
    fresh?: boolean;
    canBook?: boolean;
    code?: string | null;
    gateMessage?: string | null;
  } | null;
}): { block: boolean; message: string | null } {
  if (!isInventoryLiveSyncRequired(input)) {
    return { block: false, message: null };
  }
  if (!input.gate) {
    return { block: true, message: LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE };
  }
  if (input.gate.fresh !== true) {
    if (input.gate.code === "missing_sheet_for_date") {
      return { block: true, message: LIVE_SYNC_SHEET_TAB_MISSING_MESSAGE };
    }
    return { block: true, message: LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE };
  }
  if (input.gate.canBook === false) {
    const gateMessage =
      typeof input.gate.gateMessage === "string" ? input.gate.gateMessage.trim() : "";
    return {
      block: true,
      message: gateMessage || BOOK_SLOT_JUST_TAKEN_MESSAGE,
    };
  }
  return { block: false, message: null };
}

/** Mensaje de usuario tras hard gate book_gate (nunca UNVERIFIED si fresh=true). */
export function resolveBookGateBlockMessage(input: {
  gate: {
    fresh?: boolean;
    canBook?: boolean;
    gateMessage?: string | null;
    code?: string | null;
  } | null;
  blocked: { block: boolean; message: string | null };
}): string {
  if (!input.blocked.block) return "";
  if (input.blocked.message) return input.blocked.message;
  if (input.gate?.fresh === true) {
    const gateMessage =
      typeof input.gate.gateMessage === "string" ? input.gate.gateMessage.trim() : "";
    if (gateMessage) return gateMessage;
    if (input.gate.canBook === false) return BOOK_SLOT_JUST_TAKEN_MESSAGE;
  }
  if (typeof input.gate?.gateMessage === "string" && input.gate.gateMessage.trim()) {
    return input.gate.gateMessage.trim();
  }
  return LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE;
}

export const BIOMETRIC_INVENTORY_SYNCED_LABEL =
  "Cupos sincronizados con Google Sheets" as const;

/** Invariante UI: inventario fresh + label synced no puede coexistir con UNVERIFIED. */
export function isContradictoryBiometricInventoryUi(input: {
  inventoryFresh: boolean;
  inventoryLabel: string | null;
  bookingError: string | null;
}): boolean {
  return (
    input.bookingError === LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE &&
    input.inventoryFresh === true &&
    input.inventoryLabel === BIOMETRIC_INVENTORY_SYNCED_LABEL
  );
}

export function reconcileBookingErrorAfterAvailabilityResync(input: {
  previousError: string;
  inventoryFresh: boolean;
}): string | null {
  if (
    input.previousError === LIVE_SYNC_CUPOS_UNVERIFIED_MESSAGE &&
    input.inventoryFresh === true
  ) {
    return null;
  }
  return input.previousError;
}

export type BiometricBookGateAttempt = {
  blocked: boolean;
  bookGateError: string | null;
  mayCallBookBiometricos: boolean;
};

/** Hard gate live-sync antes de book_biometricos (fail-closed). */
export function resolveBiometricBookGateAttempt(input: {
  kind: string;
  locationId: string;
  bookingDate: string;
  gate: {
    fresh?: boolean;
    canBook?: boolean;
    code?: string | null;
    gateMessage?: string | null;
  } | null;
}): BiometricBookGateAttempt {
  const blocked = shouldBlockBookWithoutLiveSync(input);
  if (blocked.block) {
    return {
      blocked: true,
      bookGateError: resolveBookGateBlockMessage({ gate: input.gate, blocked }),
      mayCallBookBiometricos: false,
    };
  }
  return { blocked: false, bookGateError: null, mayCallBookBiometricos: true };
}

/** Inventario RPC fresh NO prueba book_gate; nunca limpia el error del gate. */
export function preserveBookGateErrorAfterAvailabilityFallback(input: {
  bookGateError: string;
  inventoryFresh: boolean;
}): string {
  void input.inventoryFresh;
  return input.bookGateError;
}

export type FirmasBookGateAttempt = BiometricBookGateAttempt;

/** Hard gate live-sync antes de book_firmas / reagendar_firmas (fail-closed). */
export function resolveFirmasBookGateAttempt(input: {
  kind: string;
  locationId: string;
  bookingDate: string;
  gate: {
    fresh?: boolean;
    canBook?: boolean;
    code?: string | null;
    gateMessage?: string | null;
  } | null;
}): FirmasBookGateAttempt {
  const blocked = shouldBlockBookWithoutLiveSync(input);
  if (blocked.block) {
    return {
      blocked: true,
      bookGateError: resolveBookGateBlockMessage({ gate: input.gate, blocked }),
      mayCallBookBiometricos: false,
    };
  }
  return { blocked: false, bookGateError: null, mayCallBookBiometricos: true };
}

export const FIRMAS_INVENTORY_SYNCED_LABEL =
  "Cupos sincronizados con Google Sheets" as const;

export function shouldShowFirmasInventorySyncedLabel(input: {
  inventoryLabel: string | null;
  bookGateError: string | null;
}): boolean {
  if (input.bookGateError) return false;
  return input.inventoryLabel === FIRMAS_INVENTORY_SYNCED_LABEL;
}

/** Label verde solo si no hay fallo activo del hard gate de reserva. */
export function shouldShowBiometricInventorySyncedLabel(input: {
  inventoryLabel: string | null;
  bookGateError: string | null;
}): boolean {
  if (input.bookGateError) return false;
  return input.inventoryLabel === BIOMETRIC_INVENTORY_SYNCED_LABEL;
}
