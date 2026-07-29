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

export type TechWriteDecision =
  | { ok: true; mode: "write" | "idempotent" }
  | { ok: false; reason: "other_booking" | "unexpected_data"; message: string };

export function extractTechCells(
  row: ReadonlyArray<string | null | undefined>,
): string[] {
  if (row.length < 7) {
    return ["", "", "", "", "", "", ""];
  }
  if (row.length === 7) {
    return row.map((c) => String(c ?? ""));
  }
  if (row.length > COL_INDEX.estado) {
    return [
      String(row[COL_INDEX.estado] ?? ""),
      String(row[COL_INDEX.bookingId] ?? ""),
      String(row[COL_INDEX.expedienteId] ?? ""),
      String(row[COL_INDEX.slotKey] ?? ""),
      String(row[COL_INDEX.syncSource] ?? ""),
      String(row[COL_INDEX.syncUpdatedAt] ?? ""),
      String(row[COL_INDEX.syncVersion] ?? ""),
    ];
  }
  return ["", "", "", "", "", "", ""];
}

function techEmpty(tech: ReadonlyArray<string>): boolean {
  return tech.every((c) => !String(c ?? "").trim());
}

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
