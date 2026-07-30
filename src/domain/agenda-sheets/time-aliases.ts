/**
 * Alias horario CRM (lógico) ↔ Google Sheets (físico).
 * Fuente canónica compartida por inventario, claim, worker y webhook.
 *
 * Ejemplo verificado: monterrey|apodaca + biometricos:
 *   logical 08:00 ⇄ sheet 08:30
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
    if (a.locationId !== input.locationId || a.kind !== input.kind) continue;
    if (normalizeHhMm(a.sheetStartTime) === sheet) {
      return normalizeHhMm(a.logicalStartTime) ?? a.logicalStartTime;
    }
  }
  return sheet;
}

export function resolveSheetStartTime(input: {
  aliases: readonly AgendaSheetTimeAlias[];
  locationId: string;
  kind: string;
  logicalStartTime: string;
}): string {
  const logical = normalizeHhMm(input.logicalStartTime) ??
    String(input.logicalStartTime ?? "").slice(0, 5);
  for (const a of input.aliases) {
    if (!aliasActive(a)) continue;
    if (a.locationId !== input.locationId || a.kind !== input.kind) continue;
    if (normalizeHhMm(a.logicalStartTime) === logical) {
      return normalizeHhMm(a.sheetStartTime) ?? a.sheetStartTime;
    }
  }
  return logical;
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

/** Alias iniciales verificados por auditoría Sheet (no firmas). */
export const DEFAULT_BIOMETRICOS_0800_0830_ALIASES: readonly AgendaSheetTimeAlias[] = [
  {
    locationId: "monterrey",
    kind: "biometricos",
    logicalStartTime: "08:00",
    sheetStartTime: "08:30",
    active: true,
  },
  {
    locationId: "apodaca",
    kind: "biometricos",
    logicalStartTime: "08:00",
    sheetStartTime: "08:30",
    active: true,
  },
];
