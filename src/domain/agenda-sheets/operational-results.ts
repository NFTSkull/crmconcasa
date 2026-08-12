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
  formatSignatureResultRaw,
  type OperationalResultClass,
} from "./operational-result-classifiers";
import { extractOperationalNote } from "./operational-notes";
import {
  evaluateOperationalRedFlags,
  EMPTY_OPERATIONAL_RED_FLAGS,
  type EffectiveBackground,
  type EffectiveBackgroundGrid,
} from "./effective-background";

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
  notes_raw: string | null;
  biometric_cell_red: boolean;
  notification_cell_red: boolean;
  signature_cell_red: boolean;
  operational_red_veto: boolean;
  operational_red_columns?: string[];
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
 * Señal de firma: col F = FIRMO, col G = FIRMA.
 * Notas H/I (COMPLETO / FALTA ACUSE) no se usan para decidir firma.
 */
export function extractFirmoFirmaCells(
  row: ReadonlyArray<string | null | undefined>,
): { firmo: string; firma: string } {
  return {
    firmo: cell(row, 5), // F
    firma: cell(row, 6), // G
  };
}

/** @deprecated Usar extractFirmoFirmaCells + formatSignatureResultRaw. */
export function extractSignatureResultRaw(
  row: ReadonlyArray<string | null | undefined>,
): string {
  const { firmo, firma } = extractFirmoFirmaCells(row);
  return formatSignatureResultRaw(firmo, firma) ?? "";
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

  const { firmo, firma } = extractFirmoFirmaCells(input.row);
  return {
    biometric_result_class: "PENDING",
    biometric_result_raw: null,
    // Notificaciones a registro = solo bloque biométricos (col F).
    notification_result_class: "PENDING",
    notification_result_raw: null,
    signature_result_class: classifySignatureResult(firmo, firma),
    signature_result_raw: formatSignatureResultRaw(firmo, firma),
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
  /** Grid E:I alineado al mismo índice de fila que A:U (p.ej. E1:I200). */
  backgroundsEi?: EffectiveBackgroundGrid | null;
}): OperationalResultUpsertRow[] {
  const out: OperationalResultUpsertRow[] = [];
  let section: { kind: AgendaSheetKind; location_id: AgendaSheetSede } | null =
    null;
  let headerRow: ReadonlyArray<string | null | undefined> | null = null;

  for (let i = 0; i < input.grid.length; i++) {
    const row = input.grid[i] ?? [];
    const a = cell(row, 0);
    const sectionParse = parseSheetSectionHeader(a);
    if (sectionParse.ok) {
      section = {
        kind: sectionParse.value.kind,
        location_id: sectionParse.value.sede,
      };
      headerRow = null;
      continue;
    }
    if (!section) continue;
    if (isSheetColumnHeaderRow(a)) {
      headerRow = row;
      continue;
    }

    // Inventario exige hora; reporting Firmas puede incluir filas con A vacío
    // si hay identidad operativa (NSS/NOMBRE/FIRMO). No crea slots de agenda.
    let slotTime: string | null = null;
    if (a) {
      const timeParse = parseSheetTime(a);
      if (!timeParse.ok) continue;
      slotTime = timeParse.value;
    } else if (section.kind === "firmas") {
      const nss = cell(row, 1);
      const nombre = cell(row, 2);
      const firmo = cell(row, 5);
      if (!nss && !nombre && !firmo) continue;
      slotTime = null;
    } else {
      continue;
    }

    const classified = classifyOperationalRow({
      kind: section.kind,
      row,
    });
    const bookingId = asUuidOrNull(cell(row, 15)); // P
    const expedienteId = asUuidOrNull(cell(row, 16)); // Q
    const redFlags =
      input.backgroundsEi == null
        ? EMPTY_OPERATIONAL_RED_FLAGS
        : evaluateOperationalRedFlags({
            kind: section.kind,
            eiBackgrounds: input.backgroundsEi[i] ?? null,
          });

    out.push({
      organization_id: input.organizationId,
      spreadsheet_id: input.spreadsheetId,
      sheet_id: input.sheetId,
      sheet_title: input.sheetTitle,
      booking_date: input.bookingDate,
      sheet_row: i + 1,
      kind: section.kind,
      location_id: section.location_id,
      slot_time: slotTime,
      booking_id: bookingId,
      expediente_id: expedienteId,
      ...classified,
      notes_raw: extractOperationalNote({
        kind: section.kind,
        row,
        headerRow,
      }),
      biometric_cell_red: redFlags.biometric_cell_red,
      notification_cell_red: redFlags.notification_cell_red,
      signature_cell_red: redFlags.signature_cell_red,
      operational_red_veto: redFlags.operational_red_veto,
      operational_red_columns: [...redFlags.operational_red_columns],
    });
  }

  return out;
}

/** Una fila: requiere kind/location conocidos (p.ej. webhook). */
export function buildOperationalResultFromRow(input: {
  organizationId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  sheetRow: number;
  kind: AgendaSheetKind | string;
  locationId: AgendaSheetSede | string;
  row: ReadonlyArray<string | null | undefined>;
  headerRow?: ReadonlyArray<string | null | undefined> | null;
  eiBackgrounds?: ReadonlyArray<EffectiveBackground> | null;
}): OperationalResultUpsertRow | null {
  if (input.kind !== "biometricos" && input.kind !== "firmas") return null;
  if (input.locationId !== "monterrey" && input.locationId !== "apodaca") {
    return null;
  }
  const a = cell(input.row, 0);
  let slotTime: string | null = null;
  if (a) {
    const timeParse = parseSheetTime(a);
    if (!timeParse.ok) return null;
    slotTime = timeParse.value;
  } else if (input.kind === "firmas") {
    const nss = cell(input.row, 1);
    const nombre = cell(input.row, 2);
    const firmo = cell(input.row, 5);
    if (!nss && !nombre && !firmo) return null;
    slotTime = null;
  } else {
    return null;
  }
  const classified = classifyOperationalRow({
    kind: input.kind,
    row: input.row,
  });
  const redFlags =
    input.eiBackgrounds == null
      ? EMPTY_OPERATIONAL_RED_FLAGS
      : evaluateOperationalRedFlags({
          kind: input.kind,
          eiBackgrounds: input.eiBackgrounds,
        });
  return {
    organization_id: input.organizationId,
    spreadsheet_id: input.spreadsheetId,
    sheet_id: input.sheetId,
    sheet_title: input.sheetTitle,
    booking_date: input.bookingDate,
    sheet_row: input.sheetRow,
    kind: input.kind,
    location_id: input.locationId,
    slot_time: slotTime,
    booking_id: asUuidOrNull(cell(input.row, 15)),
    expediente_id: asUuidOrNull(cell(input.row, 16)),
    ...classified,
    notes_raw: extractOperationalNote({
      kind: input.kind,
      row: input.row,
      headerRow: input.headerRow,
    }),
    biometric_cell_red: redFlags.biometric_cell_red,
    notification_cell_red: redFlags.notification_cell_red,
    signature_cell_red: redFlags.signature_cell_red,
    operational_red_veto: redFlags.operational_red_veto,
    operational_red_columns: [...redFlags.operational_red_columns],
  };
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
