/** Horarios bookables NUEVOS Firmas (post-contrato P212). Legacy grandfather en citas activas. */
export const FIRMAS_NEW_BOOKABLE_SLOT_TIMES = ["08:00", "09:00", "10:00"] as const;

export type FirmasNewBookableSlotTime = (typeof FIRMAS_NEW_BOOKABLE_SLOT_TIMES)[number];

/**
 * Activación EXPLÍCITA del contrato (Fase 1.7).
 * Sin fecha fija 2026-09-01: el publish controlado setea enabled (+ effectiveFrom opcional).
 */
export type FirmasDailyCapContractState = Readonly<{
  enabled: boolean;
  /** YMD configurado al publicar; null = sin cota de fecha cuando enabled. */
  effectiveFrom?: string | null;
}>;

/** Default seguro: contrato OFF hasta publicación controlada. */
export const FIRMAS_DAILY_CAP_CONTRACT_DEFAULT: FirmasDailyCapContractState = {
  enabled: false,
  effectiveFrom: null,
};

export function isFirmasDailyCapContractActive(
  bookingDate: string,
  contract: FirmasDailyCapContractState = FIRMAS_DAILY_CAP_CONTRACT_DEFAULT,
): boolean {
  if (!contract.enabled) return false;
  const d = String(bookingDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const from = contract.effectiveFrom?.trim().slice(0, 10) || null;
  if (!from) return true;
  return d >= from;
}

export function isFirmasNewBookableSlotTime(time: string): boolean {
  const t = String(time ?? "").trim().slice(0, 5);
  return (FIRMAS_NEW_BOOKABLE_SLOT_TIMES as readonly string[]).includes(t);
}

/** Picker: solo 08/09/10 para reservas nuevas bajo contrato; legacy visible al reagendar cita activa. */
export function filterFirmasPickerSlotTimes(input: {
  allSlotTimes: readonly string[];
  bookingDate: string;
  reagendar: boolean;
  activeBookingTime?: string | null;
  /** Default OFF — no hardcode de cutover. */
  contract?: FirmasDailyCapContractState;
}): readonly string[] {
  if (!isFirmasDailyCapContractActive(input.bookingDate, input.contract)) {
    return input.allSlotTimes;
  }
  const allowed = new Set<string>(FIRMAS_NEW_BOOKABLE_SLOT_TIMES);
  if (input.reagendar && input.activeBookingTime) {
    const legacy = String(input.activeBookingTime).trim().slice(0, 5);
    if (legacy) allowed.add(legacy);
  }
  return input.allSlotTimes.filter((t) => allowed.has(t.slice(0, 5)));
}
