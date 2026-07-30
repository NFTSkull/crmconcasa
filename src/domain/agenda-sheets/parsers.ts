/**
 * Parsers y normalización para sincronización Agenda ↔ Google Sheets («CITAS 2026»).
 * Zona de integración: America/Mexico_City (documentada; CRM interno usa America/Monterrey).
 * No escribe en Sheets ni Supabase.
 */

export const AGENDA_SHEETS_DEFAULT_SPREADSHEET_ID =
  "1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA";

export const AGENDA_SHEETS_TIMEZONE = "America/Mexico_City";

export const AGENDA_SHEETS_YEAR_FROM_TITLE = /^CITAS\s+(\d{4})\s*$/i;

const MONTHS_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

export type AgendaSheetSede = "monterrey" | "apodaca";
export type AgendaSheetKind = "biometricos" | "firmas";

export type ParseOk<T> = Readonly<{ ok: true; value: T }>;
export type ParseErr = Readonly<{ ok: false; error: string }>;
export type ParseResult<T> = ParseOk<T> | ParseErr;

export function parseYearFromSpreadsheetTitle(
  title: string | null | undefined,
): ParseResult<number> {
  const t = String(title ?? "").trim();
  const m = AGENDA_SHEETS_YEAR_FROM_TITLE.exec(t);
  if (!m) {
    return { ok: false, error: `Título de libro no reconocido: "${t}"` };
  }
  const year = Number(m[1]);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return { ok: false, error: `Año inválido en título: "${t}"` };
  }
  return { ok: true, value: year };
}

/**
 * Parsea títulos de pestaña tipo `29 JULIO`, `03 AGOSTO ` → YYYY-MM-DD (calendario local).
 * No convierte a UTC de forma que cambie el día.
 */
export function parseSheetTabDate(
  tabTitle: string | null | undefined,
  year: number,
): ParseResult<string> {
  const raw = String(tabTitle ?? "").trim().replace(/\s+/g, " ");
  if (!raw) {
    return { ok: false, error: "Título de pestaña vacío" };
  }
  const m = /^(\d{1,2})\s+([A-Za-záéíóúñÁÉÍÓÚÑ]+)$/u.exec(raw);
  if (!m) {
    return { ok: false, error: `Pestaña no reconocida como fecha: "${raw}"` };
  }
  const day = Number(m[1]);
  const monthKey = m[2]
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const month = MONTHS_ES[monthKey];
  if (!month) {
    return { ok: false, error: `Mes inválido en pestaña: "${raw}"` };
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return { ok: false, error: `Año inválido: ${year}` };
  }
  if (day < 1 || day > 31) {
    return { ok: false, error: `Día inválido en pestaña: "${raw}"` };
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return { ok: false, error: `Fecha de calendario inválida: "${raw}" ${year}` };
  }
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return { ok: true, value: `${yyyy}-${mm}-${dd}` };
}

/**
 * Normaliza hora de hoja a `HH:mm` (24h).
 * Acepta: 8:30AM, 8:30 AM, 8:30, 10:00 AM, 10:00 a. m., 9:30AM, 11:00
 */
export function parseSheetTime(raw: string | null | undefined): ParseResult<string> {
  const t = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bA\.\s*M\.?/gi, "AM")
    .replace(/\bP\.\s*M\.?/gi, "PM")
    .toUpperCase();
  if (!t) {
    return { ok: false, error: "Hora vacía" };
  }
  const m =
    /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(t) ??
    /^(\d{1,2}):(\d{2})(AM|PM)$/i.exec(t);
  if (!m) {
    return { ok: false, error: `Hora inválida: "${raw}"` };
  }
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = (m[3] ?? "").toUpperCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return { ok: false, error: `Hora inválida: "${raw}"` };
  }
  if (minute < 0 || minute > 59) {
    return { ok: false, error: `Minutos inválidos: "${raw}"` };
  }
  if (ampm === "AM" || ampm === "PM") {
    if (hour < 1 || hour > 12) {
      return { ok: false, error: `Hora AM/PM inválida: "${raw}"` };
    }
    if (ampm === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
  } else if (hour < 0 || hour > 23) {
    return { ok: false, error: `Hora inválida: "${raw}"` };
  }
  return {
    ok: true,
    value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

/** NSS como texto: quita apóstrofes/espacios/guiones; conserva ceros; exige 11 dígitos. */
export function normalizeSheetNss(
  raw: string | null | undefined,
): ParseResult<string> {
  let s = String(raw ?? "").trim();
  // Apóstrofes tipográficos y ASCII usados para forzar texto en Sheets
  s = s.replace(/^['´`’]+/, "");
  s = s.replace(/[\s\-_.]/g, "");
  s = s.replace(/[^\d]/g, "");
  if (!/^\d{11}$/.test(s)) {
    return {
      ok: false,
      error: `NSS inválido (se esperan 11 dígitos): "${raw}"`,
    };
  }
  return { ok: true, value: s };
}

export function normalizeSectionHeader(
  raw: string | null | undefined,
): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function parseSheetSectionHeader(
  cellA: string | null | undefined,
): ParseResult<{ sede: AgendaSheetSede; kind: AgendaSheetKind }> {
  const n = normalizeSectionHeader(cellA);
  if (!n) return { ok: false, error: "Encabezado de sección vacío" };

  const map: Record<string, { sede: AgendaSheetSede; kind: AgendaSheetKind }> = {
    "MONTERREY FIRMAS": { sede: "monterrey", kind: "firmas" },
    "MONTERREY BIOMETRICOS": { sede: "monterrey", kind: "biometricos" },
    "APODACA FIRMAS": { sede: "apodaca", kind: "firmas" },
    "APODACA BIOMETRICOS": { sede: "apodaca", kind: "biometricos" },
  };
  const hit = map[n];
  if (!hit) {
    return { ok: false, error: `Sección no reconocida: "${cellA}"` };
  }
  return { ok: true, value: hit };
}

export function isSheetColumnHeaderRow(cellA: string | null | undefined): boolean {
  const n = normalizeSectionHeader(cellA);
  return n === "HORA" || n.startsWith("HORA");
}

/** Marcadores que terminan un bloque de slots (no son horarios). */
export function isSheetBlockTerminator(cellA: string | null | undefined): boolean {
  const n = normalizeSectionHeader(cellA);
  if (!n) return false;
  if (n.includes("CITAS CANCELADAS")) return true;
  if (n === "NO HAY CITAS" || n.startsWith("NO HAY CITAS")) return true;
  if (n.includes("NO HUBO ACUSES")) return true;
  if (parseSheetSectionHeader(cellA).ok) return true;
  return false;
}

export type SheetSlotRow = Readonly<{
  rowNumber: number;
  sede: AgendaSheetSede;
  kind: AgendaSheetKind;
  slotTime: string;
  slotOrdinal: number;
  horaRaw: string;
  nssRaw: string;
  nombreRaw: string;
  asesorRaw: string;
}>;

/**
 * Enumera slots de una pestaña (col A=hora, B=NSS, C=nombre, D=asesor).
 * `rows` indexados desde 0; `rowNumber` es 1-based (Sheets).
 * Horas repetidas reciben ordinal 1..N dentro de (sede, kind, time).
 */
export function enumerateSheetSlots(input: {
  sheetDate: string;
  rows: ReadonlyArray<ReadonlyArray<string>>;
  startRowNumber?: number;
}): ReadonlyArray<SheetSlotRow> {
  const start = input.startRowNumber ?? 1;
  const out: SheetSlotRow[] = [];
  let section: { sede: AgendaSheetSede; kind: AgendaSheetKind } | null = null;
  let afterHeader = false;
  const ordinals = new Map<string, number>();

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i] ?? [];
    const rowNumber = start + i;
    const a = String(row[0] ?? "");
    const sectionParse = parseSheetSectionHeader(a);
    if (sectionParse.ok) {
      section = sectionParse.value;
      afterHeader = false;
      continue;
    }
    if (!section) continue;
    if (isSheetColumnHeaderRow(a)) {
      afterHeader = true;
      continue;
    }
    if (!afterHeader) continue;
    if (isSheetBlockTerminator(a)) {
      section = null;
      afterHeader = false;
      continue;
    }
    const timeParse = parseSheetTime(a);
    if (!timeParse.ok) {
      // fila no-horario dentro del bloque: fin de slots útiles
      if (String(a).trim() === "") continue;
      section = null;
      afterHeader = false;
      continue;
    }
    const key = `${section.sede}|${section.kind}|${timeParse.value}`;
    const next = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, next);
    out.push({
      rowNumber,
      sede: section.sede,
      kind: section.kind,
      slotTime: timeParse.value,
      slotOrdinal: next,
      horaRaw: a,
      nssRaw: String(row[1] ?? ""),
      nombreRaw: String(row[2] ?? ""),
      asesorRaw: String(row[3] ?? ""),
    });
  }
  return out;
}

/** Identidad de cupo CRM (sin ordinal). El ordinal vive solo en el mapping Sheet. */
export function crmSlotKey(input: {
  kind: AgendaSheetKind;
  date: string;
  time: string;
  locationId: AgendaSheetSede;
}): string {
  return `${input.kind}|${input.date}|${input.time}|${input.locationId}`;
}

/**
 * Construye timestamptz ISO asumiendo date+time en America/Mexico_City.
 * Usa offset fijo -06:00 (sin DST en MX desde 2022); suficiente para integración.
 */
export function sheetLocalDateTimeToIso(
  dateYmd: string,
  timeHm: string,
): ParseResult<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
    return { ok: false, error: `Fecha inválida: ${dateYmd}` };
  }
  if (!/^\d{2}:\d{2}$/.test(timeHm)) {
    return { ok: false, error: `Hora inválida: ${timeHm}` };
  }
  return { ok: true, value: `${dateYmd}T${timeHm}:00-06:00` };
}

export type AgendaSheetSyncStatus =
  | "SINCRONIZADO"
  | "PENDIENTE"
  | "CONFLICTO"
  | "ERROR"
  | "CANCELADA";

// Columnas técnicas: ver tech-columns.ts (O:U). H:N = PRESERVAR.
export {
  AGENDA_SHEET_TECH_COLUMNS,
  AGENDA_SHEET_TECH_RANGE,
  AGENDA_SHEET_PRESERVE_RANGE,
} from "./tech-columns";
