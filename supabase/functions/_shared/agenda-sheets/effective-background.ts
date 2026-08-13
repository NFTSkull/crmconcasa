/**
 * P173 — fondo efectivo de celdas Sheet (solo BACKGROUND, no font).
 * Criterio rojo operativo: #FF0000 (r≥0.95, g≤0.08, b≤0.08).
 */

export type EffectiveBackground = {
  red: number;
  green: number;
  blue: number;
} | null;

export type RgbChannels = Readonly<{
  red?: number | null;
  green?: number | null;
  blue?: number | null;
  alpha?: number | null;
}>;

/** Columnas operativas E:I → índices 0..4 dentro de un grid E:I. */
export const OPERATIONAL_EI_COLUMNS = ["E", "F", "G", "H", "I"] as const;
export type OperationalEiColumn = (typeof OPERATIONAL_EI_COLUMNS)[number];

export function eiColumnIndex(col: OperationalEiColumn): number {
  return OPERATIONAL_EI_COLUMNS.indexOf(col);
}

/**
 * Normaliza backgroundColorStyle.rgbColor o backgroundColor de Google Sheets.
 * Canales ausentes = 0. Sin lanzar.
 */
export function normalizeGoogleBackground(
  input: unknown,
): EffectiveBackground {
  if (input == null || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  // Preferir backgroundColorStyle.rgbColor
  const style = obj.backgroundColorStyle;
  if (style && typeof style === "object") {
    const rgb = (style as Record<string, unknown>).rgbColor;
    if (rgb && typeof rgb === "object") {
      return channelsToBg(rgb as RgbChannels);
    }
    // themeColor sin rgb → no es rojo operable
    if ((style as Record<string, unknown>).themeColor != null) return null;
  }

  const legacy = obj.backgroundColor;
  if (legacy && typeof legacy === "object") {
    return channelsToBg(legacy as RgbChannels);
  }

  // effectiveFormat wrapper
  const ef = obj.effectiveFormat;
  if (ef && typeof ef === "object") {
    return normalizeGoogleBackground(ef);
  }

  // Canal directo
  if ("red" in obj || "green" in obj || "blue" in obj) {
    return channelsToBg(obj as RgbChannels);
  }

  return null;
}

function channelsToBg(c: RgbChannels): EffectiveBackground {
  const red = clamp01(numOr0(c.red));
  const green = clamp01(numOr0(c.green));
  const blue = clamp01(numOr0(c.blue));
  // alpha no decide; background ausente total (todo 0) se trata como blanco/negro
  // Google omite canales en 0 → {red:1} = #FF0000
  return { red, green, blue };
}

function numOr0(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function backgroundToHex(bg: EffectiveBackground): string | null {
  if (!bg) return null;
  const h = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${h(bg.red)}${h(bg.green)}${h(bg.blue)}`;
}

/**
 * Rojo operativo CITAS 2026 (#FF0000). Conservador: no traga rosa/morado/naranja.
 */
export type OperationalColor =
  | "GREEN"
  | "RED"
  | "ORANGE"
  | "OTHER"
  | "UNKNOWN";

/** Verdes auditados CITAS 2026 (KPI positivo visual). */
export const OPERATIONAL_GREEN_HEX = ["#6AA84F", "#93C47D"] as const;
export const OPERATIONAL_RED_HEX = "#FF0000" as const;
export const OPERATIONAL_ORANGE_HEX = "#FF9900" as const;

export function normalizeHexColor(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim().toUpperCase();
  if (!t) return null;
  const h = t.startsWith("#") ? t : `#${t}`;
  if (!/^#[0-9A-F]{6}$/.test(h)) return null;
  return h;
}

/**
 * Clasifica hex auditado → OperationalColor.
 * Hex inválido/ausente → UNKNOWN (fail-closed).
 */
export function operationalColorFromHex(
  hex: string | null | undefined,
): OperationalColor {
  const n = normalizeHexColor(hex);
  if (!n) return "UNKNOWN";
  if (n === OPERATIONAL_RED_HEX) return "RED";
  if (
    n === OPERATIONAL_ORANGE_HEX ||
    n === "#E69138" ||
    n === "#F6B26B"
  ) {
    return "ORANGE";
  }
  if ((OPERATIONAL_GREEN_HEX as readonly string[]).includes(n)) return "GREEN";
  return "OTHER";
}

/**
 * Sin lectura usable → UNKNOWN (no inventar verde).
 */
export function classifyOperationalColor(
  bg: EffectiveBackground | string | null | undefined,
): OperationalColor {
  if (typeof bg === "string") return operationalColorFromHex(bg);
  const n =
    bg && typeof bg === "object" && "red" in bg
      ? (bg as Exclude<EffectiveBackground, null>)
      : null;
  if (!n) return "UNKNOWN";
  return operationalColorFromHex(backgroundToHex(n));
}

export function isOperationalRedBackground(
  bg: EffectiveBackground | unknown,
): boolean {
  // P173 compatible: equivale a classifyOperationalColor === RED.
  if (bg && typeof bg === "object" && "red" in (bg as object)) {
    return classifyOperationalColor(bg as EffectiveBackground) === "RED";
  }
  const n = normalizeGoogleBackground(bg);
  return classifyOperationalColor(n) === "RED";
}

/** Grid de backgrounds alineada al range (fila 0 / col 0 = primera celda). */
export type EffectiveBackgroundGrid = ReadonlyArray<
  ReadonlyArray<EffectiveBackground>
>;

export type OperationalRedFlags = Readonly<{
  biometric_cell_red: boolean;
  notification_cell_red: boolean;
  signature_cell_red: boolean;
  operational_red_veto: boolean;
  operational_red_columns: OperationalEiColumn[];
}>;

export const EMPTY_OPERATIONAL_RED_FLAGS: OperationalRedFlags = {
  biometric_cell_red: false,
  notification_cell_red: false,
  signature_cell_red: false,
  operational_red_veto: false,
  operational_red_columns: [],
};

/**
 * Evalúa E:I de una fila del grid de backgrounds (índice 0 = E).
 * kind informa flags específicos; veto = cualquier E:I rojo.
 */
export function evaluateOperationalRedFlags(input: {
  kind: "biometricos" | "firmas" | string;
  /** Fila de backgrounds E:I (length ≤5). */
  eiBackgrounds: ReadonlyArray<EffectiveBackground> | null | undefined;
}): OperationalRedFlags {
  const row = input.eiBackgrounds ?? [];
  const redCols: OperationalEiColumn[] = [];
  for (let i = 0; i < OPERATIONAL_EI_COLUMNS.length; i++) {
    if (isOperationalRedBackground(row[i] ?? null)) {
      redCols.push(OPERATIONAL_EI_COLUMNS[i]!);
    }
  }
  const veto = redCols.length > 0;
  const has = (c: OperationalEiColumn) => redCols.includes(c);
  const kind = String(input.kind ?? "").toLowerCase();
  return {
    biometric_cell_red: kind === "biometricos" && has("E"),
    notification_cell_red: kind === "biometricos" && has("F"),
    signature_cell_red: kind === "firmas" && has("F"),
    operational_red_veto: veto,
    operational_red_columns: redCols,
  };
}

/**
 * Parsea respuesta spreadsheets.get (includeGridData) a grid EffectiveBackground.
 * Espera sheets[0].data[0].rowData[].values[].effectiveFormat
 */
export function parseEffectiveBackgroundGridFromSheetsGet(
  json: unknown,
): EffectiveBackground[][] {
  const out: EffectiveBackground[][] = [];
  if (!json || typeof json !== "object") return out;
  const sheets = (json as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) return out;
  const data = (sheets[0] as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return out;
  const rowData = (data[0] as { rowData?: unknown }).rowData;
  if (!Array.isArray(rowData)) return out;
  for (const rd of rowData) {
    const values = (rd as { values?: unknown })?.values;
    const row: EffectiveBackground[] = [];
    if (Array.isArray(values)) {
      for (const cell of values) {
        const ef =
          cell && typeof cell === "object"
            ? (cell as { effectiveFormat?: unknown }).effectiveFormat
            : null;
        row.push(normalizeGoogleBackground(ef ?? cell));
      }
    }
    out.push(row);
  }
  return out;
}
