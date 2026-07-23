import {
  CYNTHIA_SEDE_APODACA_ID,
  CYNTHIA_SEDE_MONTERREY_ID,
  resolveCanonicalSedeId,
  type CynthiaSedeId,
  type WeeklyLocationLike,
} from "./agendaCynthiaLocations";

export type AdvisorSedeOption = Readonly<{
  /** Valor del selector en UI (`monterrey` | `apodaca`). */
  canonicalId: CynthiaSedeId;
  /** Etiqueta humana para el asesor. */
  label: string;
  /** ID enviado al RPC `book_*` / `reagendar_*`. */
  bookLocationId: string;
  /** IDs de config/bookings legacy que consolidan esta sede. */
  sourceLocationIds: readonly string[];
  enabled: boolean;
  capacityPerSlot: number;
  /** Cupo recurrente por hora (P123); vacío = solo capacityPerSlot. */
  capacityByTime: Readonly<Record<string, number>>;
}>;

export const ADVISOR_SEDE_LABELS: Record<CynthiaSedeId, string> = {
  [CYNTHIA_SEDE_MONTERREY_ID]: "Monterrey",
  [CYNTHIA_SEDE_APODACA_ID]: "Apodaca",
};

const CANONICAL_ORDER: readonly CynthiaSedeId[] = [
  CYNTHIA_SEDE_MONTERREY_ID,
  CYNTHIA_SEDE_APODACA_ID,
];

type Bucket = {
  sourceLocationIds: string[];
  enabled: boolean;
  capacityPerSlot: number;
  capacityByTime: Record<string, number>;
  hasCanonicalRow: boolean;
  firstLegacyId: string | null;
};

function emptyBucket(): Bucket {
  return {
    sourceLocationIds: [],
    enabled: false,
    capacityPerSlot: 0,
    capacityByTime: {},
    hasCanonicalRow: false,
    firstLegacyId: null,
  };
}

/**
 * Opciones de sede para asesor: solo Monterrey y Apodaca.
 * `bookLocationId` usa el ID canónico si está en config; si no, el primer legacy mapeable.
 */
export function buildAdvisorSedeOptions(
  locations: readonly WeeklyLocationLike[],
): AdvisorSedeOption[] {
  const buckets: Record<CynthiaSedeId, Bucket> = {
    [CYNTHIA_SEDE_MONTERREY_ID]: emptyBucket(),
    [CYNTHIA_SEDE_APODACA_ID]: emptyBucket(),
  };

  for (const loc of locations) {
    const canonical = resolveCanonicalSedeId(loc.id, loc.label);
    if (!canonical) continue;

    const bucket = buckets[canonical];
    bucket.sourceLocationIds.push(loc.id);
    if (loc.id === canonical) bucket.hasCanonicalRow = true;
    else if (!bucket.firstLegacyId) bucket.firstLegacyId = loc.id;

    if (loc.enabled !== false) {
      bucket.enabled = true;
      const cap = Math.max(1, Math.trunc(Number(loc.capacityPerSlot) || 1));
      bucket.capacityPerSlot = Math.max(bucket.capacityPerSlot, cap);
      if (loc.capacityByTime) {
        for (const [time, value] of Object.entries(loc.capacityByTime)) {
          const n = Math.trunc(Number(value));
          if (!Number.isFinite(n) || n < 1) continue;
          bucket.capacityByTime[time] = Math.max(bucket.capacityByTime[time] ?? 0, n);
        }
      }
    }
  }

  return CANONICAL_ORDER.flatMap((canonicalId) => {
    const bucket = buckets[canonicalId];
    if (!bucket.sourceLocationIds.length || !bucket.enabled) return [];

    const bookLocationId = bucket.hasCanonicalRow
      ? canonicalId
      : (bucket.firstLegacyId ?? canonicalId);

    return [
      {
        canonicalId,
        label: ADVISOR_SEDE_LABELS[canonicalId],
        bookLocationId,
        sourceLocationIds: bucket.sourceLocationIds,
        enabled: true,
        capacityPerSlot: Math.max(1, bucket.capacityPerSlot),
        capacityByTime: { ...bucket.capacityByTime },
      },
    ];
  });
}

export function mapLocationIdToAdvisorCanonical(
  locationId: string,
  locations: readonly WeeklyLocationLike[],
): CynthiaSedeId | null {
  const label = locations.find((l) => l.id === locationId)?.label ?? "";
  return resolveCanonicalSedeId(locationId, label);
}

export function advisorLabelForLocationId(
  locationId: string,
  locations: readonly WeeklyLocationLike[],
): string {
  const canonical = mapLocationIdToAdvisorCanonical(locationId, locations);
  if (canonical) return ADVISOR_SEDE_LABELS[canonical];
  const raw = locations.find((l) => l.id === locationId)?.label?.trim();
  return raw || locationId;
}

export function advisorOptionIncludesBookingLocation(
  option: AdvisorSedeOption,
  bookingLocationId: string,
  locations: readonly WeeklyLocationLike[] = [],
): boolean {
  if (option.sourceLocationIds.includes(bookingLocationId)) return true;
  const bookingCanonical = mapLocationIdToAdvisorCanonical(bookingLocationId, locations);
  return bookingCanonical != null && bookingCanonical === option.canonicalId;
}

/** True si el booking pertenece a la sede asesor (canónica o legacy mapeable). */
export function bookingBelongsToAdvisorSede(
  bookingLocationId: string,
  option: AdvisorSedeOption,
  locations: readonly WeeklyLocationLike[],
): boolean {
  return advisorOptionIncludesBookingLocation(option, bookingLocationId, locations);
}
