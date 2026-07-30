/**
 * Alias horario CRM (lógico) ↔ Google Sheets (físico) — many-to-one.
 * Un horario lógico puede mapear a varios horarios físicos.
 *
 * Ejemplos biométricos MTY/APO:
 *   08:00 ← [08:30]
 *   10:00 ← [10:00, 11:00]
 *
 * Identidades:
 * - Lógica (capacidad/booking): kind|date|logical|location
 * - Física (fila Sheet): kind|date|logical|location|sheet=HH:mm|sheetId=N|row=N
 */

export type AgendaSheetTimeAlias = Readonly<{
  locationId: "monterrey" | "apodaca" | string;
  kind: "biometricos" | "firmas" | string;
  logicalStartTime: string; // HH:mm
  sheetStartTime: string; // HH:mm
  active?: boolean;
}>;

/** Normaliza a HH:mm (24h). Acepta HH:mm[:ss]. */
export function normalizeHhMm(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function aliasActive(a: AgendaSheetTimeAlias): boolean {
  return a.active !== false;
}

function scopeMatch(
  a: AgendaSheetTimeAlias,
  locationId: string,
  kind: string,
): boolean {
  return a.locationId === locationId && a.kind === kind;
}

/** Físico → lógico (exactamente uno, o identidad). */
export function resolveLogicalStartTime(input: {
  aliases: readonly AgendaSheetTimeAlias[];
  locationId: string;
  kind: string;
  sheetStartTime: string;
}): string {
  const sheet = normalizeHhMm(input.sheetStartTime) ??
    String(input.sheetStartTime ?? "").slice(0, 5);
  for (const a of input.aliases) {
    if (!aliasActive(a)) continue;
    if (!scopeMatch(a, input.locationId, input.kind)) continue;
    if (normalizeHhMm(a.sheetStartTime) === sheet) {
      return normalizeHhMm(a.logicalStartTime) ?? a.logicalStartTime;
    }
  }
  return sheet;
}

/**
 * Lógico → conjunto físico ordenado, sin duplicados.
 * Preferencia de claim/write: orden ascendente de HH:mm.
 * Si no hay alias: identidad [logical].
 */
export function resolvePhysicalSheetTimes(input: {
  aliases: readonly AgendaSheetTimeAlias[];
  locationId: string;
  kind: string;
  logicalStartTime: string;
}): string[] {
  const logical = normalizeHhMm(input.logicalStartTime) ??
    String(input.logicalStartTime ?? "").slice(0, 5);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of input.aliases) {
    if (!aliasActive(a)) continue;
    if (!scopeMatch(a, input.locationId, input.kind)) continue;
    if (normalizeHhMm(a.logicalStartTime) !== logical) continue;
    const sheet = normalizeHhMm(a.sheetStartTime) ?? a.sheetStartTime;
    if (seen.has(sheet)) continue;
    seen.add(sheet);
    out.push(sheet);
  }
  out.sort();
  if (out.length === 0) return [logical];
  return out;
}

/**
 * Primer físico preferido del pool (compat worker legacy).
 * Preferir resolvePhysicalSheetTimes para selección many-to-one.
 */
export function resolveSheetStartTime(input: {
  aliases: readonly AgendaSheetTimeAlias[];
  locationId: string;
  kind: string;
  logicalStartTime: string;
}): string {
  return resolvePhysicalSheetTimes(input)[0]!;
}

/** Compara dos HH:mm para orden determinista de claim. */
export function compareHhMm(a: string, b: string): number {
  const na = normalizeHhMm(a) ?? a;
  const nb = normalizeHhMm(b) ?? b;
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/**
 * Orden determinista de candidatas de inventario para un booking lógico:
 * 1) sheet_slot_time según pool (ya ascendente)
 * 2) row_number ascendente
 */
export function sortInventoryCandidatesForLogicalBooking<
  T extends { sheetStartTime: string; rowNumber: number },
>(rows: readonly T[]): T[] {
  return [...rows].sort((x, y) => {
    const c = compareHhMm(x.sheetStartTime, y.sheetStartTime);
    if (c !== 0) return c;
    return x.rowNumber - y.rowNumber;
  });
}

/** Identidad lógica de capacidad/booking (sin fila Sheet). */
export function buildLogicalBookingKey(input: {
  kind: string;
  bookingDate: string;
  logicalStartTime: string;
  locationId: string;
}): string {
  const logical = normalizeHhMm(input.logicalStartTime) ?? input.logicalStartTime;
  return `${input.kind}|${input.bookingDate}|${logical}|${input.locationId}`;
}

/**
 * Identidad física canónica de una fila Sheet.
 * Usada por inventario, slot_link (columna R), worker y webhook.
 */
export function buildPhysicalSheetRowKey(input: {
  kind: string;
  bookingDate: string;
  logicalStartTime: string;
  sheetStartTime: string;
  locationId: string;
  sheetId: number | string;
  rowNumber: number;
}): string {
  const logical = normalizeHhMm(input.logicalStartTime) ?? input.logicalStartTime;
  const sheet = normalizeHhMm(input.sheetStartTime) ?? input.sheetStartTime;
  const sheetId = String(input.sheetId);
  const row = Math.trunc(Number(input.rowNumber));
  return (
    `${input.kind}|${input.bookingDate}|${logical}|${input.locationId}` +
    `|sheet=${sheet}|sheetId=${sheetId}|row=${row}`
  );
}

export type ParsedPhysicalSheetRowKey = Readonly<{
  kind: string;
  bookingDate: string;
  logicalStartTime: string;
  locationId: string;
  sheetStartTime: string;
  sheetId: string;
  rowNumber: number;
  format: "canonical" | "legacy_ordinal";
}>;

/**
 * Lectura compatible: formato canónico o legado
 * `kind|date|time|location|ordinal[|sheet=HH:mm]`.
 */
export function parsePhysicalSheetRowKey(
  raw: string | null | undefined,
): ParsedPhysicalSheetRowKey | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const canonical =
    /^([^|]+)\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|([^|]+)\|sheet=(\d{2}:\d{2})\|sheetId=([^|]+)\|row=(\d+)$/;
  const m = canonical.exec(s);
  if (m) {
    return {
      kind: m[1]!,
      bookingDate: m[2]!,
      logicalStartTime: m[3]!,
      locationId: m[4]!,
      sheetStartTime: m[5]!,
      sheetId: m[6]!,
      rowNumber: Number(m[7]),
      format: "canonical",
    };
  }
  const legacy =
    /^([^|]+)\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|([^|]+)\|(\d+)(?:\|sheet=(\d{2}:\d{2}))?$/;
  const l = legacy.exec(s);
  if (l) {
    const logical = l[3]!;
    return {
      kind: l[1]!,
      bookingDate: l[2]!,
      logicalStartTime: logical,
      locationId: l[4]!,
      sheetStartTime: l[6] ?? logical,
      sheetId: "",
      rowNumber: Number(l[5]),
      format: "legacy_ordinal",
    };
  }
  return null;
}

/**
 * @deprecated Preferir buildPhysicalSheetRowKey (identidad canónica).
 * Conservado solo para lectura de tests/legado ordinal.
 */
export function buildAliasedSlotKey(input: {
  kind: string;
  bookingDate: string;
  logicalStartTime: string;
  sheetStartTime: string;
  locationId: string;
  ordinal: number;
}): string {
  const logical = normalizeHhMm(input.logicalStartTime) ?? input.logicalStartTime;
  const sheet = normalizeHhMm(input.sheetStartTime) ?? input.sheetStartTime;
  const base =
    `${input.kind}|${input.bookingDate}|${logical}|${input.locationId}|${input.ordinal}`;
  if (sheet !== logical) return `${base}|sheet=${sheet}`;
  return base;
}

/**
 * Defaults biométricos verificados (05–07 AGOSTO):
 * - MTY/APO: 08:00 ← 08:30
 * - MTY/APO: 10:00 ← 10:00 + 11:00
 * Firmas: sin alias (identidad).
 */
export const DEFAULT_BIOMETRICOS_TIME_ALIASES: readonly AgendaSheetTimeAlias[] = [
  {
    locationId: "monterrey",
    kind: "biometricos",
    logicalStartTime: "08:00",
    sheetStartTime: "08:30",
    active: true,
  },
  {
    locationId: "monterrey",
    kind: "biometricos",
    logicalStartTime: "10:00",
    sheetStartTime: "10:00",
    active: true,
  },
  {
    locationId: "monterrey",
    kind: "biometricos",
    logicalStartTime: "10:00",
    sheetStartTime: "11:00",
    active: true,
  },
  {
    locationId: "apodaca",
    kind: "biometricos",
    logicalStartTime: "08:00",
    sheetStartTime: "08:30",
    active: true,
  },
  {
    locationId: "apodaca",
    kind: "biometricos",
    logicalStartTime: "10:00",
    sheetStartTime: "10:00",
    active: true,
  },
  {
    locationId: "apodaca",
    kind: "biometricos",
    logicalStartTime: "10:00",
    sheetStartTime: "11:00",
    active: true,
  },
];

/** @deprecated Usar DEFAULT_BIOMETRICOS_TIME_ALIASES (many-to-one). */
export const DEFAULT_BIOMETRICOS_0800_0830_ALIASES = DEFAULT_BIOMETRICOS_TIME_ALIASES;
