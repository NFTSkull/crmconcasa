/**
 * Contrato único de columnas técnicas Agenda ↔ Sheets («CITAS 2026»).
 * Rango seguro confirmado por auditoría read-only: O:U.
 * H:N contiene datos operativos reales → PRESERVAR (nunca escribir).
 *
 * Las filas de Google Sheets API son sparse: `values.length === 7` NO implica O:U.
 * La extracción exige origen absoluto o un rango O:U explícito.
 */

/** Letras A1 de columnas técnicas (O=15 … U=21, 1-based). */
export const AGENDA_SHEET_TECH_COLUMNS = {
  estado: "O",
  bookingId: "P",
  expedienteId: "Q",
  slotKey: "R",
  syncSource: "S",
  syncUpdatedAt: "T",
  syncVersion: "U",
} as const;

export const AGENDA_SHEET_TECH_RANGE = "O:U" as const;
export const AGENDA_SHEET_PRESERVE_RANGE = "A:N" as const;

/** Índices 0-based dentro de una fila anclada en columna A (startColumnIndex=0). */
export const AGENDA_SHEET_COL_INDEX = {
  hora: 0, // A
  nss: 1, // B
  nombre: 2, // C
  asesor: 3, // D
  // E–N (4–13) PRESERVAR
  estado: 14, // O
  bookingId: 15, // P
  expedienteId: 16, // Q
  slotKey: 17, // R
  syncSource: 18, // S
  syncUpdatedAt: 19, // T
  syncVersion: 20, // U
} as const;

/** Columnas 1-based (Apps Script / Sheets API). */
export const AGENDA_SHEET_COL_1BASED = {
  hora: 1,
  nss: 2,
  nombre: 3,
  asesor: 4,
  techStart: 15, // O
  techEnd: 21, // U
  estado: 15,
  bookingId: 16,
  expedienteId: 17,
  slotKey: 18,
  syncSource: 19,
  syncUpdatedAt: 20,
  syncVersion: 21,
} as const;

export const AGENDA_SHEET_TECH_HEADERS = [
  "ESTADO CRM",
  "CRM_BOOKING_ID",
  "CRM_EXPEDIENTE_ID",
  "CRM_SLOT_KEY",
  "CRM_SYNC_SOURCE",
  "CRM_SYNC_UPDATED_AT",
  "CRM_SYNC_VERSION",
] as const;

/**
 * Origen inequívoco de una fila de valores.
 * - `absolute_row`: `row[i]` es la columna `startColumnIndex + i` (0-based Sheets).
 * - `tech_range_ou`: los valores se leyeron del rango A1 `O:U` (o `O{n}:U{n}`).
 */
export type TechCellSource =
  | { kind: "absolute_row"; startColumnIndex: number }
  | { kind: "tech_range_ou" };

export const TECH_SOURCE_FROM_COLUMN_A: TechCellSource = {
  kind: "absolute_row",
  startColumnIndex: 0,
};

export const TECH_SOURCE_EXPLICIT_OU: TechCellSource = {
  kind: "tech_range_ou",
};

export type TechWriteOk = Readonly<{
  ok: true;
  mode: "write" | "idempotent";
}>;
export type TechWriteConflict = Readonly<{
  ok: false;
  reason: "other_booking" | "unexpected_data";
  message: string;
}>;
export type TechWriteDecision = TechWriteOk | TechWriteConflict;

function cell(row: ReadonlyArray<string | null | undefined>, idx: number): string {
  return String(row[idx] ?? "").trim();
}

/**
 * Extrae O:U (7 celdas) usando posición absoluta de columna.
 * Nunca interpreta A:G ni H:N como O:U por `length === 7`.
 */
export function extractTechCells(
  row: ReadonlyArray<string | null | undefined>,
  source: TechCellSource = TECH_SOURCE_FROM_COLUMN_A,
): string[] {
  const out = ["", "", "", "", "", "", ""];
  if (source.kind === "tech_range_ou") {
    for (let i = 0; i < 7; i++) {
      out[i] = String(row[i] ?? "");
    }
    return out;
  }
  const start = source.startColumnIndex;
  if (!Number.isInteger(start) || start < 0) {
    return out;
  }
  for (let t = 0; t < 7; t++) {
    const absCol = AGENDA_SHEET_COL_INDEX.estado + t; // 14..20
    const idxInRow = absCol - start;
    if (idxInRow >= 0 && idxInRow < row.length) {
      out[t] = String(row[idxInRow] ?? "");
    }
  }
  return out;
}

export function techCellsAreEmpty(tech: ReadonlyArray<string>): boolean {
  return tech.every((c) => !String(c ?? "").trim());
}

/**
 * Antes de escribir O:U:
 * - vacío → write
 * - P = mismo booking → idempotent
 * - P = otro booking → conflicto (no escribir)
 * - P vacío pero O:U con datos → unexpected (no escribir)
 */
export function assertTechColumnsWritable(input: {
  existingRowOrTech: ReadonlyArray<string | null | undefined>;
  bookingId: string;
  /** Default: fila anclada en A. Pasar `tech_range_ou` si el arreglo es O:U explícito. */
  source?: TechCellSource;
}): TechWriteDecision {
  const bookingId = String(input.bookingId ?? "").trim();
  if (!bookingId) {
    return {
      ok: false,
      reason: "unexpected_data",
      message: "booking_id vacío: no se escribe O:U",
    };
  }
  const tech = extractTechCells(
    input.existingRowOrTech,
    input.source ?? TECH_SOURCE_FROM_COLUMN_A,
  );
  const existingBooking = cell(tech, 1); // P dentro del slice O:U
  if (!existingBooking) {
    if (!techCellsAreEmpty(tech)) {
      return {
        ok: false,
        reason: "unexpected_data",
        message: "O:U contiene datos inesperados sin CRM_BOOKING_ID",
      };
    }
    return { ok: true, mode: "write" };
  }
  if (existingBooking === bookingId) {
    return { ok: true, mode: "idempotent" };
  }
  return {
    ok: false,
    reason: "other_booking",
    message: "CRM_BOOKING_ID pertenece a otra cita; no se sobrescribe",
  };
}

/** True si alguna celda O:U de la pestaña tiene contenido no vacío (filas ancladas en A). */
export function tabHasUnexpectedTechData(
  rows: ReadonlyArray<ReadonlyArray<string | null | undefined>>,
  source: TechCellSource = TECH_SOURCE_FROM_COLUMN_A,
): { blocked: boolean; samples: Array<{ rowNumber: number; col: string }> } {
  const samples: Array<{ rowNumber: number; col: string }> = [];
  const letters = ["O", "P", "Q", "R", "S", "T", "U"] as const;
  for (let r = 0; r < rows.length; r++) {
    const tech = extractTechCells(rows[r] ?? [], source);
    for (let i = 0; i < tech.length; i++) {
      if (!String(tech[i] ?? "").trim()) continue;
      const v = String(tech[i] ?? "").trim();
      if (AGENDA_SHEET_TECH_HEADERS.includes(v as (typeof AGENDA_SHEET_TECH_HEADERS)[number])) {
        continue;
      }
      if (samples.length < 12) {
        samples.push({ rowNumber: r + 1, col: letters[i]! });
      }
    }
  }
  return { blocked: samples.length > 0, samples };
}

export function buildTechWriteRow(input: {
  estado: string;
  bookingId: string;
  expedienteId: string;
  slotKey: string;
  syncSource: "crm" | "sheets";
  syncUpdatedAt: string;
  syncVersion: string | number;
}): string[] {
  return [
    input.estado,
    input.bookingId,
    input.expedienteId,
    input.slotKey,
    input.syncSource,
    input.syncUpdatedAt,
    String(input.syncVersion),
  ];
}

export function a1TechRange(sheetTitle: string, rowNumber: number): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!O${rowNumber}:U${rowNumber}`;
}

export function a1TechColumnsRange(sheetTitle: string): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!O:U`;
}

export function a1VisibleRange(sheetTitle: string, rowNumber: number): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!A${rowNumber}:D${rowNumber}`;
}

export function a1FullReadRange(sheetTitle: string, rowNumber: number): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!A${rowNumber}:U${rowNumber}`;
}

/** Solo B:D — escritura booking / clear cancel. Nunca incluye A. */
export function a1BdRange(sheetTitle: string, rowNumber: number): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!B${rowNumber}:D${rowNumber}`;
}

/** @deprecated Usar a1BdRange. */
export function a1ClearBdRange(sheetTitle: string, rowNumber: number): string {
  return a1BdRange(sheetTitle, rowNumber);
}

/** Solo O:U — cancelación; nunca incluye G:N. */
export function a1ClearOuRange(sheetTitle: string, rowNumber: number): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!O${rowNumber}:U${rowNumber}`;
}

/** Nunca debe escribirse en H:N (columnas 8–14, 1-based). */
export function isPreserveOnlyColumn1Based(col: number): boolean {
  return col >= 8 && col <= 14;
}

export function isTechColumn1Based(col: number): boolean {
  return col >= AGENDA_SHEET_COL_1BASED.techStart &&
    col <= AGENDA_SHEET_COL_1BASED.techEnd;
}
