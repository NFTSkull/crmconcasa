/** Sedes canónicas para Cynthia — IDs internos fijos, sin exponer legacy en UI. */
export const CYNTHIA_SEDE_MONTERREY_ID = "monterrey";
export const CYNTHIA_SEDE_APODACA_ID = "apodaca";

export type CynthiaSedeId = typeof CYNTHIA_SEDE_MONTERREY_ID | typeof CYNTHIA_SEDE_APODACA_ID;

export type CynthiaSedeFormState = Readonly<{
  enabled: boolean;
  capacityPerSlot: number;
  /** Cupos recurrentes por hora; se conservan al quitar un horario. */
  capacityByTime: Readonly<Record<string, number>>;
}>;

export type WeeklyLocationLike = Readonly<{
  id: string;
  label: string;
  enabled: boolean;
  capacityPerSlot: number;
  capacityByTime?: Readonly<Record<string, number>>;
}>;

const LEGACY_ID_MAP: Record<string, CynthiaSedeId> = {
  monterrey: CYNTHIA_SEDE_MONTERREY_ID,
  apodaca: CYNTHIA_SEDE_APODACA_ID,
  "mty-centro": CYNTHIA_SEDE_MONTERREY_ID,
  "mty_centro": CYNTHIA_SEDE_MONTERREY_ID,
  "sede-centro": CYNTHIA_SEDE_MONTERREY_ID,
  "san-nicolas": CYNTHIA_SEDE_APODACA_ID,
  "san_nicolas": CYNTHIA_SEDE_APODACA_ID,
};

const DEFAULT_SEDE: CynthiaSedeFormState = {
  enabled: true,
  capacityPerSlot: 5,
  capacityByTime: {},
};

function emptyCynthiaSedes(): Record<CynthiaSedeId, CynthiaSedeFormState> {
  return {
    [CYNTHIA_SEDE_MONTERREY_ID]: { ...DEFAULT_SEDE, capacityByTime: {} },
    [CYNTHIA_SEDE_APODACA_ID]: { ...DEFAULT_SEDE, capacityByTime: {} },
  };
}

function normalizeCapacityByTime(
  raw: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const t = key.trim();
    if (!/^\d{2}:\d{2}$/.test(t)) continue;
    const n = Math.trunc(Number(value));
    // P126: 0 = cerrado explícito; negativo se descarta
    if (!Number.isFinite(n) || n < 0) continue;
    out[t] = n;
  }
  return out;
}

/** Mapea IDs/labels legacy a Monterrey o Apodaca; ignora sedes no reconocibles. */
export function resolveCanonicalSedeId(id: string, label: string): CynthiaSedeId | null {
  const key = id.trim().toLowerCase();
  if (LEGACY_ID_MAP[key]) return LEGACY_ID_MAP[key];

  const labelL = label.trim().toLowerCase();
  if (
    key.includes("apodaca") ||
    key.includes("nicol") ||
    labelL.includes("apodaca") ||
    labelL.includes("nicol")
  ) {
    return CYNTHIA_SEDE_APODACA_ID;
  }
  if (
    key.includes("monterrey") ||
    key.includes("mty") ||
    key === "sede-centro" ||
    labelL.includes("monterrey") ||
    (labelL.includes("centro") && !labelL.includes("nicol"))
  ) {
    return CYNTHIA_SEDE_MONTERREY_ID;
  }
  return null;
}

/** Config SQL/UI → formulario Cynthia (solo Monterrey + Apodaca). */
export function weeklyLocationsToCynthiaForm(
  locations: readonly WeeklyLocationLike[],
): Record<CynthiaSedeId, CynthiaSedeFormState> {
  const out = emptyCynthiaSedes();
  const mapped = new Set<CynthiaSedeId>();

  for (const loc of locations) {
    const canonical = resolveCanonicalSedeId(loc.id, loc.label);
    if (!canonical) continue;
    const cap = Math.max(1, Math.trunc(Number(loc.capacityPerSlot) || 1));
    const enabled = loc.enabled !== false;
    const cbt = normalizeCapacityByTime(loc.capacityByTime);

    if (!mapped.has(canonical)) {
      out[canonical] = { enabled, capacityPerSlot: cap, capacityByTime: cbt };
      mapped.add(canonical);
      continue;
    }

    const current = out[canonical];
    out[canonical] = {
      enabled: current.enabled || enabled,
      capacityPerSlot: enabled ? Math.max(current.capacityPerSlot, cap) : current.capacityPerSlot,
      capacityByTime: { ...current.capacityByTime, ...cbt },
    };
  }

  if (!locations.length || mapped.size === 0) {
    return emptyCynthiaSedes();
  }

  return out;
}

/** Formulario Cynthia → payload semanal (solo monterrey + apodaca). */
export function cynthiaFormToWeeklyLocations(
  sedes: Record<CynthiaSedeId, CynthiaSedeFormState>,
): WeeklyLocationLike[] {
  return [
    {
      id: CYNTHIA_SEDE_MONTERREY_ID,
      label: "Monterrey",
      enabled: sedes[CYNTHIA_SEDE_MONTERREY_ID].enabled,
      capacityPerSlot: Math.max(1, Math.trunc(sedes[CYNTHIA_SEDE_MONTERREY_ID].capacityPerSlot || 1)),
      capacityByTime: normalizeCapacityByTime(sedes[CYNTHIA_SEDE_MONTERREY_ID].capacityByTime),
    },
    {
      id: CYNTHIA_SEDE_APODACA_ID,
      label: "Apodaca",
      enabled: sedes[CYNTHIA_SEDE_APODACA_ID].enabled,
      capacityPerSlot: Math.max(1, Math.trunc(sedes[CYNTHIA_SEDE_APODACA_ID].capacityPerSlot || 1)),
      capacityByTime: normalizeCapacityByTime(sedes[CYNTHIA_SEDE_APODACA_ID].capacityByTime),
    },
  ];
}

/**
 * Cupo mostrado/editable para un horario. Vacío si aún no hay valor explícito.
 * P126: 0 es valor válido (cerrado), distinto de vacío.
 */
export function resolveSedeSlotCapacityDraft(
  sede: CynthiaSedeFormState,
  slot: string,
): number | "" {
  if (!Object.prototype.hasOwnProperty.call(sede.capacityByTime, slot)) return "";
  const specific = sede.capacityByTime[slot];
  if (typeof specific === "number" && Number.isFinite(specific) && specific >= 0) {
    return Math.trunc(specific);
  }
  return "";
}

/** Valida que cada horario tenga cupo ≥0 (explícito) en cada sede activa. Vacío = error. */
export function missingExplicitSlotCapacities(
  slots: readonly string[],
  sedes: Record<CynthiaSedeId, CynthiaSedeFormState>,
): string | null {
  const labels: Record<CynthiaSedeId, string> = {
    [CYNTHIA_SEDE_MONTERREY_ID]: "Monterrey",
    [CYNTHIA_SEDE_APODACA_ID]: "Apodaca",
  };
  for (const slot of slots) {
    for (const id of [CYNTHIA_SEDE_MONTERREY_ID, CYNTHIA_SEDE_APODACA_ID] as const) {
      if (!sedes[id].enabled) continue;
      if (!Object.prototype.hasOwnProperty.call(sedes[id].capacityByTime, slot)) {
        return `Falta cupo para ${slot} en ${labels[id]}.`;
      }
      const n = sedes[id].capacityByTime[slot];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
        return `Falta cupo para ${slot} en ${labels[id]}.`;
      }
    }
  }
  return null;
}

/** Valida y normaliza horario HH:mm; null si inválido. */
export function parseHhmmSlotInput(value: string): string | null {
  const t = value.trim();
  if (!/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [hRaw, mRaw] = t.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
