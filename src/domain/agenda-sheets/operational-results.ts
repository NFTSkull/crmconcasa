/**
 * Proyección de resultados operativos CITAS 2026 (reporting Bernardo).
 * No altera inventario de disponibilidad ni agenda_bookings.
 */

import {
  isSheetColumnHeaderRow,
  parseSheetSectionHeader,
  parseSheetTime,
  type AgendaSheetKind,
  type AgendaSheetSede,
} from "./parsers";
import {
  classifyBiometricResult,
  classifyNotificationResult,
  classifySignatureResult,
  type OperationalResultClass,
} from "./operational-result-classifiers";

export type OperationalResultUpsertRow = Readonly<{
  organization_id: string;
  spreadsheet_id: string;
  sheet_id: number;
  sheet_title: string;
  booking_date: string;
  sheet_row: number;
  kind: AgendaSheetKind;
  location_id: AgendaSheetSede;
  slot_time: string | null;
  booking_id: string | null;
  expediente_id: string | null;
  biometric_result_class: OperationalResultClass;
  biometric_result_raw: string | null;
  notification_result_class: OperationalResultClass;
  notification_result_raw: string | null;
  signature_result_class: OperationalResultClass;
  signature_result_raw: string | null;
}>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cell(
  row: ReadonlyArray<string | null | undefined> | undefined,
  idx: number,
): string {
  return String(row?.[idx] ?? "").trim();
}

function asUuidOrNull(raw: string): string | null {
  const t = raw.trim();
  return UUID_RE.test(t) ? t : null;
}

function nullIfEmpty(raw: string): string | null {
  const t = raw.trim();
  return t ? t : null;
}

/**
 * Señal de firma completa: canónica en col I (layout actual CITAS 2026).
 * Fallback: escanea H–N por COMPLETO / FALTA ACUSE / NO FIRMO / REAGENDA
 * para sobrevivir corrimientos razonables sin inventar completado.
 */
export function extractSignatureResultRaw(
  row: ReadonlyArray<string | null | undefined>,
): string {
  const preferred = cell(row, 8); // I
  if (preferred) return preferred;
  const markers = [
    "COMPLETO",
    "FALTA ACUSE",
    "NO FIRMO",
    "NO ASISTIO",
    "REAGENDA",
  ];
  for (let c = 7; c <= 13; c++) {
    if (c === 8) continue;
    const v = cell(row, c);
    if (!v) continue;
    const n = v
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toUpperCase();
    if (markers.some((m) => n.includes(m))) return v;
  }
  return "";
}

/** Clasifica una fila ya ubicada en sección biométricos o firmas. */
export function classifyOperationalRow(input: {
  kind: AgendaSheetKind;
  row: ReadonlyArray<string | null | undefined>;
}): {
  biometric_result_class: OperationalResultClass;
  biometric_result_raw: string | null;
  notification_result_class: OperationalResultClass;
  notification_result_raw: string | null;
  signature_result_class: OperationalResultClass;
  signature_result_raw: string | null;
} {
  const e = cell(input.row, 4);
  const f = cell(input.row, 5);
  const sigRaw = extractSignatureResultRaw(input.row);

  if (input.kind === "biometricos") {
    return {
      biometric_result_class: classifyBiometricResult(e),
      biometric_result_raw: nullIfEmpty(e),
      notification_result_class: classifyNotificationResult(f),
      notification_result_raw: nullIfEmpty(f),
      signature_result_class: "PENDING",
      signature_result_raw: null,
    };
  }

  return {
    biometric_result_class: "PENDING",
    biometric_result_raw: null,
    // Notificaciones a registro = solo bloque biométricos (col F).
    notification_result_class: "PENDING",
    notification_result_raw: null,
    signature_result_class: classifySignatureResult(sigRaw),
    signature_result_raw: nullIfEmpty(sigRaw),
  };
}

/**
 * Construye filas de proyección desde grilla A:U (o al menos A:I + P/Q).
 * Incluye filas con horario físico aunque estén vacías (PENDING) para
 * que una edición posterior sea idempotente por (spreadsheet, sheet, row).
 */
export function buildOperationalResultUpsertRows(input: {
  organizationId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  grid: ReadonlyArray<ReadonlyArray<string | null | undefined>>;
}): OperationalResultUpsertRow[] {
  const out: OperationalResultUpsertRow[] = [];
  let section: { kind: AgendaSheetKind; location_id: AgendaSheetSede } | null =
    null;

  for (let i = 0; i < input.grid.length; i++) {
    const row = input.grid[i] ?? [];
    const a = cell(row, 0);
    const sectionParse = parseSheetSectionHeader(a);
    if (sectionParse.ok) {
      section = {
        kind: sectionParse.value.kind,
        location_id: sectionParse.value.sede,
      };
      continue;
    }
    if (!section) continue;
    if (!a || isSheetColumnHeaderRow(a)) continue;

    const timeParse = parseSheetTime(a);
    if (!timeParse.ok) continue;

    const classified = classifyOperationalRow({
      kind: section.kind,
      row,
    });
    const bookingId = asUuidOrNull(cell(row, 15)); // P
    const expedienteId = asUuidOrNull(cell(row, 16)); // Q

    out.push({
      organization_id: input.organizationId,
      spreadsheet_id: input.spreadsheetId,
      sheet_id: input.sheetId,
      sheet_title: input.sheetTitle,
      booking_date: input.bookingDate,
      sheet_row: i + 1,
      kind: section.kind,
      location_id: section.location_id,
      slot_time: timeParse.value,
      booking_id: bookingId,
      expediente_id: expedienteId,
      ...classified,
    });
  }

  return out;
}

/** KPI Bernardo: solo COMPLETED según métrica. */
export function countCompletedOperational(input: {
  rows: readonly OperationalResultUpsertRow[];
  metric: "biometricos" | "firmas" | "notificaciones";
}): number {
  let n = 0;
  for (const r of input.rows) {
    if (input.metric === "biometricos") {
      if (r.kind === "biometricos" && r.biometric_result_class === "COMPLETED") {
        n += 1;
      }
    } else if (input.metric === "firmas") {
      if (r.kind === "firmas" && r.signature_result_class === "COMPLETED") {
        n += 1;
      }
    } else if (
      r.kind === "biometricos" &&
      r.notification_result_class === "COMPLETED"
    ) {
      n += 1;
    }
  }
  return n;
}
