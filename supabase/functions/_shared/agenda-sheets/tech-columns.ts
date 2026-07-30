/**
 * Contrato columnas técnicas O:U (mirror de src/domain/agenda-sheets/tech-columns.ts).
 * Mantener en sync. H:N = PRESERVAR.
 */

export const TECH_COLUMNS = {
  estado: "O",
  bookingId: "P",
  expedienteId: "Q",
  slotKey: "R",
  syncSource: "S",
  syncUpdatedAt: "T",
  syncVersion: "U",
} as const;

export const TECH_RANGE = "O:U";
export const PRESERVE_RANGE = "A:N";

export const COL_INDEX = {
  hora: 0,
  nss: 1,
  nombre: 2,
  asesor: 3,
  estado: 14,
  bookingId: 15,
  expedienteId: 16,
  slotKey: 17,
  syncSource: 18,
  syncUpdatedAt: 19,
  syncVersion: 20,
} as const;

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

export type TechWriteDecision =
  | { ok: true; mode: "write" | "idempotent" }
  | { ok: false; reason: "other_booking" | "unexpected_data"; message: string };

export function extractTechCells(
  row: ReadonlyArray<string | null | undefined>,
  source: TechCellSource = TECH_SOURCE_FROM_COLUMN_A,
): string[] {
  const out = ["", "", "", "", "", "", ""];
  if (source.kind === "tech_range_ou") {
    for (let i = 0; i < 7; i++) out[i] = String(row[i] ?? "");
    return out;
  }
  const start = source.startColumnIndex;
  if (!Number.isInteger(start) || start < 0) return out;
  for (let t = 0; t < 7; t++) {
    const absCol = COL_INDEX.estado + t;
    const idxInRow = absCol - start;
    if (idxInRow >= 0 && idxInRow < row.length) {
      out[t] = String(row[idxInRow] ?? "");
    }
  }
  return out;
}

function techEmpty(tech: ReadonlyArray<string>): boolean {
  return tech.every((c) => !String(c ?? "").trim());
}

export function assertTechColumnsWritable(input: {
  existingRowOrTech: ReadonlyArray<string | null | undefined>;
  bookingId: string;
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
  const existingBooking = String(tech[1] ?? "").trim();
  if (!existingBooking) {
    if (!techEmpty(tech)) {
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

/** Solo B:D — cancelación; nunca incluye A. */
export function a1ClearBdRange(sheetTitle: string, rowNumber: number): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!B${rowNumber}:D${rowNumber}`;
}

/** Solo O:U — cancelación; nunca incluye G:N. */
export function a1ClearOuRange(sheetTitle: string, rowNumber: number): string {
  const titleEsc = `'${sheetTitle.replace(/'/g, "''")}'`;
  return `${titleEsc}!O${rowNumber}:U${rowNumber}`;
}
