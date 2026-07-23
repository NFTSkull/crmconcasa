import type { HhmmTime } from "./types";

/** Modelo UI semanal (P3M.1) — sin calendario por día. */
export type AgendaBiometricosWeeklyLocation = Readonly<{
  id: string;
  label: string;
  enabled: boolean;
  capacityPerSlot: number;
  /** Cupo recurrente por hora HH:MM (opcional; fallback = capacityPerSlot). */
  capacityByTime?: Readonly<Record<string, number>>;
}>;

export type AgendaBiometricosWeeklyConfig = Readonly<{
  enabled: boolean;
  timezone: string;
  minLeadHours: number;
  /** ISO weekday 1 (lun) … 7 (dom). */
  allowedWeekdays: readonly number[];
  slots: readonly HhmmTime[];
  locations: readonly AgendaBiometricosWeeklyLocation[];
}>;

/** JSON canónico persistido en `agenda_config.config` (Postgres). */
export type AgendaBiometricosSqlConfig = Readonly<{
  enabled: boolean;
  timezone: string;
  min_lead_hours: number;
  allowed_weekdays: readonly number[];
  slots: readonly string[];
  locations: Readonly<
    Record<
      string,
      Readonly<{
        enabled: boolean;
        capacity_per_slot: number;
        label?: string;
        /** P123: cupo recurrente por hora. */
        capacity_by_time?: Readonly<Record<string, number>>;
      }>
    >
  >;
}>;

export const AGENDA_BIOMETRICOS_WEEKDAY_OPTIONS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 7, label: "Dom" },
] as const;

export function emptyAgendaBiometricosWeeklyConfig(): AgendaBiometricosWeeklyConfig {
  return {
    enabled: true,
    timezone: "America/Monterrey",
    minLeadHours: 24,
    allowedWeekdays: [1, 2, 3, 4, 5],
    slots: ["09:00", "10:00"],
    locations: [
      { id: "monterrey", label: "Monterrey", enabled: true, capacityPerSlot: 5 },
      { id: "apodaca", label: "Apodaca", enabled: true, capacityPerSlot: 5 },
    ],
  };
}

export function slugifyAgendaLocationId(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `ubicacion-${Date.now()}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function parseHhmm(value: unknown): HhmmTime | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return /^\d{2}:\d{2}$/.test(t) ? (t as HhmmTime) : null;
}

function parseNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const n = Number(item);
    if (Number.isInteger(n) && n >= 1 && n <= 7) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Parsea `capacity_by_time` JSON → mapa HH:MM → entero ≥1. */
export function parseCapacityByTime(raw: unknown): Record<string, number> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const time = parseHhmm(key);
    if (!time) continue;
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n) || n < 1) continue;
    out[time] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Cupo recurrente de una sede para una hora.
 * Precedencia UI/disponibilidad (antes de excepciones por fecha):
 * capacity_by_time[hora] → capacity_per_slot.
 */
export function resolveRecurrentSlotCapacity(
  capacityPerSlot: number,
  time: string,
  capacityByTime?: Readonly<Record<string, number>> | null,
): number {
  const normalized = parseHhmm(time) ?? String(time).trim();
  const specific = capacityByTime?.[normalized];
  if (typeof specific === "number" && Number.isFinite(specific) && specific >= 1) {
    return Math.trunc(specific);
  }
  return Math.max(1, Math.trunc(capacityPerSlot || 1));
}

/** SQL/JSONB → modelo UI semanal. */
export function mapSqlConfigToWeeklyUi(raw: unknown): AgendaBiometricosWeeklyConfig {
  if (!isRecord(raw)) {
    return emptyAgendaBiometricosWeeklyConfig();
  }

  const slots: HhmmTime[] = [];
  if (Array.isArray(raw.slots)) {
    for (const slot of raw.slots) {
      const parsed = parseHhmm(slot);
      if (parsed) slots.push(parsed);
    }
  }

  const locations: AgendaBiometricosWeeklyLocation[] = [];
  if (isRecord(raw.locations)) {
    for (const [id, locRaw] of Object.entries(raw.locations)) {
      if (!isRecord(locRaw)) continue;
      const capacityByTime = parseCapacityByTime(locRaw.capacity_by_time);
      const loc: AgendaBiometricosWeeklyLocation = {
        id,
        label: typeof locRaw.label === "string" && locRaw.label.trim() ? locRaw.label.trim() : id,
        enabled: locRaw.enabled !== false,
        capacityPerSlot: Math.max(
          1,
          Math.trunc(Number(locRaw.capacity_per_slot) || 1),
        ),
        ...(capacityByTime ? { capacityByTime } : {}),
      };
      locations.push(loc);
    }
    locations.sort((a, b) => a.id.localeCompare(b.id));
  }

  let minLeadHours = 24;
  if (raw.min_lead_hours != null) {
    minLeadHours = Math.max(0, Math.trunc(Number(raw.min_lead_hours) || 0));
  } else if (raw.minLeadDays != null) {
    minLeadHours = Math.max(0, Math.trunc(Number(raw.minLeadDays) || 0) * 24);
  }

  const allowedWeekdays = parseNumberArray(raw.allowed_weekdays);
  const timezone =
    typeof raw.timezone === "string" && raw.timezone.trim()
      ? raw.timezone.trim()
      : "America/Monterrey";

  return {
    enabled: raw.enabled !== false,
    timezone,
    minLeadHours,
    allowedWeekdays: allowedWeekdays.length ? allowedWeekdays : [1, 2, 3, 4, 5],
    slots: slots.length ? slots : ["09:00"],
    locations,
  };
}

/** Modelo UI semanal → JSON canónico para RPC `upsert_agenda_config_biometricos`. */
export function mapWeeklyUiToSqlCanonical(
  config: AgendaBiometricosWeeklyConfig,
): AgendaBiometricosSqlConfig {
  const locations: Record<
    string,
    {
      enabled: boolean;
      capacity_per_slot: number;
      label?: string;
      capacity_by_time?: Record<string, number>;
    }
  > = {};
  for (const loc of config.locations) {
    const id = loc.id.trim();
    if (!id) continue;
    const entry: {
      enabled: boolean;
      capacity_per_slot: number;
      label?: string;
      capacity_by_time?: Record<string, number>;
    } = {
      enabled: loc.enabled,
      capacity_per_slot: Math.max(1, Math.trunc(loc.capacityPerSlot || 1)),
    };
    const label = loc.label.trim();
    if (label) entry.label = label;
    const cbt = parseCapacityByTime(loc.capacityByTime);
    if (cbt) entry.capacity_by_time = cbt;
    locations[id] = entry;
  }

  const slots = [...new Set(config.slots.map((s) => String(s).trim()).filter(Boolean))].sort();
  const allowedWeekdays = [...new Set(config.allowedWeekdays)]
    .filter((d) => d >= 1 && d <= 7)
    .sort((a, b) => a - b);

  return {
    enabled: config.enabled,
    timezone: config.timezone.trim() || "America/Monterrey",
    min_lead_hours: Math.max(0, Math.trunc(config.minLeadHours || 0)),
    allowed_weekdays: allowedWeekdays,
    slots,
    locations,
  };
}
