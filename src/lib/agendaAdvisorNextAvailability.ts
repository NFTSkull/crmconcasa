import type { AgendaBiometricosWeeklyConfig } from "@/domain/agenda-biometricos/map-agenda-config";
import {
  addDaysYmd,
  buildScheduledAtIso,
  computeAdvisorSlotAvailability,
  getIsoWeekdayForDate,
  type WeeklyBookedSlot,
} from "@/domain/agenda-biometricos/weekly-availability";
import type { HhmmTime, YmdDate } from "@/domain/agenda-biometricos/types";
import type { AdvisorSedeOption } from "./agendaAdvisorLocations";

export const ADVISOR_NEXT_AVAILABILITY_SEARCH_DAYS = 45;

export type AdvisorEmptyDateReason =
  | "no_config"
  | "day_not_enabled"
  | "min_lead_blocked"
  | "all_full";

export type AdvisorNextAvailableSlot = Readonly<{
  date: YmdDate;
  time: HhmmTime;
  sedeLabel: string;
}>;

export type AdvisorDateAvailabilityInsight = Readonly<{
  /** null si la fecha tiene al menos un horario agendable. */
  emptyReason: AdvisorEmptyDateReason | null;
  emptyReasonMessage: string | null;
  next: AdvisorNextAvailableSlot | null;
  nextFormatted: string | null;
  noFutureMessage: string | null;
}>;

const NO_FUTURE_MSG =
  "No hay disponibilidad configurada para esta sede. Pide a Mesa que revise la agenda.";

const EMPTY_REASON_MESSAGES: Record<AdvisorEmptyDateReason, string> = {
  no_config: "No hay disponibilidad configurada para esta sede. Pide a Mesa que revise la agenda.",
  day_not_enabled: "Este día no está habilitado para citas.",
  min_lead_blocked: "Esta fecha no cumple la anticipación mínima configurada.",
  all_full: "Los horarios de esta fecha ya están llenos.",
};

function slotsForAdvisorDate(
  config: AgendaBiometricosWeeklyConfig,
  bookedSlots: readonly WeeklyBookedSlot[],
  date: YmdDate,
  sede: AdvisorSedeOption,
  now: Date,
  applyMinLeadHours: boolean,
) {
  return computeAdvisorSlotAvailability({
    config,
    bookedSlots,
    date,
    canonicalId: sede.canonicalId,
    sourceLocationIds: sede.sourceLocationIds,
    capacityPerSlot: sede.capacityPerSlot,
    capacityByTime: sede.capacityByTime,
    now,
    applyMinLeadHours,
  });
}

function diagnoseEmptyReason(
  config: AgendaBiometricosWeeklyConfig,
  bookedSlots: readonly WeeklyBookedSlot[],
  date: YmdDate,
  sede: AdvisorSedeOption,
  now: Date,
): AdvisorEmptyDateReason {
  if (!config.enabled || !config.slots.length || !sede.sourceLocationIds.length) {
    return "no_config";
  }

  const hasEnabledSource = sede.sourceLocationIds.some((id) =>
    config.locations.some((l) => l.id === id && l.enabled),
  );
  if (!hasEnabledSource) {
    return "no_config";
  }

  const isoDow = getIsoWeekdayForDate(date, config.timezone);
  if (!config.allowedWeekdays.includes(isoDow)) {
    return "day_not_enabled";
  }

  const withLead = slotsForAdvisorDate(config, bookedSlots, date, sede, now, true);
  if (withLead.some((s) => s.remaining > 0)) {
    throw new Error("diagnoseEmptyReason called with bookable slots");
  }

  const withoutLead = slotsForAdvisorDate(config, bookedSlots, date, sede, now, false);
  if (!withoutLead.length) {
    return "min_lead_blocked";
  }
  if (withoutLead.every((s) => s.remaining <= 0)) {
    return "all_full";
  }

  return "min_lead_blocked";
}

/** Próximo horario agendable para la sede en los siguientes `searchDays` días. */
export function findNextAvailableAgendaSlot(params: {
  config: AgendaBiometricosWeeklyConfig;
  bookedSlots: readonly WeeklyBookedSlot[];
  fromDate: YmdDate;
  sede: AdvisorSedeOption;
  searchDays?: number;
  now?: Date;
}): AdvisorNextAvailableSlot | null {
  const { config, bookedSlots, fromDate, sede } = params;
  const now = params.now ?? new Date();
  const searchDays = params.searchDays ?? ADVISOR_NEXT_AVAILABILITY_SEARCH_DAYS;

  let cursor = fromDate;
  for (let i = 0; i <= searchDays; i++) {
    const slots = slotsForAdvisorDate(config, bookedSlots, cursor, sede, now, true);
    const bookable = slots.filter((s) => s.remaining > 0);
    if (bookable.length > 0) {
      return {
        date: cursor,
        time: bookable[0]!.time,
        sedeLabel: sede.label,
      };
    }
    cursor = addDaysYmd(cursor, 1);
  }
  return null;
}

export function formatAdvisorNextSlotLabel(
  slot: AdvisorNextAvailableSlot,
  timeZone: string,
): string {
  const iso = buildScheduledAtIso(slot.date, slot.time, timeZone);
  const when = new Date(iso);
  const dayName = new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    timeZone,
  }).format(when);
  const datePart = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(when);
  return `${dayName} ${datePart} · ${slot.time} · ${slot.sedeLabel}`;
}

export function buildAdvisorDateAvailabilityInsight(params: {
  config: AgendaBiometricosWeeklyConfig;
  bookedSlots: readonly WeeklyBookedSlot[];
  date: YmdDate;
  sede: AdvisorSedeOption | null;
  searchDays?: number;
  now?: Date;
}): AdvisorDateAvailabilityInsight | null {
  const { config, bookedSlots, date, sede } = params;
  if (!sede) return null;

  const now = params.now ?? new Date();
  const slots = slotsForAdvisorDate(config, bookedSlots, date, sede, now, true);
  const hasBookable = slots.some((s) => s.remaining > 0);
  if (hasBookable) {
    return {
      emptyReason: null,
      emptyReasonMessage: null,
      next: null,
      nextFormatted: null,
      noFutureMessage: null,
    };
  }

  const emptyReason = diagnoseEmptyReason(config, bookedSlots, date, sede, now);
  const next = findNextAvailableAgendaSlot({
    config,
    bookedSlots,
    fromDate: date,
    sede,
    searchDays: params.searchDays,
    now,
  });

  return {
    emptyReason,
    emptyReasonMessage: EMPTY_REASON_MESSAGES[emptyReason],
    next,
    nextFormatted: next ? formatAdvisorNextSlotLabel(next, config.timezone) : null,
    noFutureMessage: next ? null : NO_FUTURE_MSG,
  };
}
