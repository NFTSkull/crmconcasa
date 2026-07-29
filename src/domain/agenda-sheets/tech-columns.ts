/**
 * Contrato único de columnas técnicas Agenda ↔ Sheets («CITAS 2026»).
 * Rango seguro confirmado por auditoría read-only: O:U.
 * H:N contiene datos operativos reales → PRESERVAR (nunca escribir).
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

/** Índices 0-based dentro de una fila A:U (21 columnas). */
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

/** Extrae O:U (7 celdas) desde una fila A:U o desde un slice O:U exacto. */
export function extractTechCells(
  row: ReadonlyArray<string | null | undefined>,
): string[] {
  // Fila operativa corta (A:D / A:G…): O:U no presentes → vacío
  if (row.length < 7) {
    return ["", "", "", "", "", "", ""];
  }
  // Slice exacto O:U
  if (row.length === 7) {
    return row.map((c) => String(c ?? ""));
  }
  // Fila ancha A:…U (o más)
  if (row.length > AGENDA_SHEET_COL_INDEX.estado) {
    return [
      String(row[AGENDA_SHEET_COL_INDEX.estado] ?? ""),
      String(row[AGENDA_SHEET_COL_INDEX.bookingId] ?? ""),
      String(row[AGENDA_SHEET_COL_INDEX.expedienteId] ?? ""),
      String(row[AGENDA_SHEET_COL_INDEX.slotKey] ?? ""),
      String(row[AGENDA_SHEET_COL_INDEX.syncSource] ?? ""),
      String(row[AGENDA_SHEET_COL_INDEX.syncUpdatedAt] ?? ""),
      String(row[AGENDA_SHEET_COL_INDEX.syncVersion] ?? ""),
    ];
  }
  // 8–14 cols: aún no llega a O → vacío técnico
  return ["", "", "", "", "", "", ""];
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
}): TechWriteDecision {
  const bookingId = String(input.bookingId ?? "").trim();
  if (!bookingId) {
    return {
      ok: false,
      reason: "unexpected_data",
      message: "booking_id vacío: no se escribe O:U",
    };
  }
  const tech = extractTechCells(input.existingRowOrTech);
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

/** True si alguna celda O:U de la pestaña tiene contenido no vacío. */
export function tabHasUnexpectedTechData(
  rows: ReadonlyArray<ReadonlyArray<string | null | undefined>>,
): { blocked: boolean; samples: Array<{ rowNumber: number; col: string }> } {
  const samples: Array<{ rowNumber: number; col: string }> = [];
  const letters = ["O", "P", "Q", "R", "S", "T", "U"] as const;
  for (let r = 0; r < rows.length; r++) {
    const tech = extractTechCells(rows[r] ?? []);
    for (let i = 0; i < tech.length; i++) {
      if (!String(tech[i] ?? "").trim()) continue;
      // Encabezados técnicos conocidos en fila 1 no bloquean si coinciden exactos
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

export function a1VisibleRange(sheetTitle: string, rowNumber: number): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!A${rowNumber}:D${rowNumber}`;
}

export function a1FullReadRange(sheetTitle: string, rowNumber: number): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!A${rowNumber}:U${rowNumber}`;
}

/** Nunca debe escribirse en H:N (columnas 8–14, 1-based). */
export function isPreserveOnlyColumn1Based(col: number): boolean {
  return col >= 8 && col <= 14;
}

export function isTechColumn1Based(col: number): boolean {
  return col >= AGENDA_SHEET_COL_1BASED.techStart &&
    col <= AGENDA_SHEET_COL_1BASED.techEnd;
}
