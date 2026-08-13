/**
 * Edge mirror: proyección resultados operativos CITAS 2026.
 */
import { parseSection, parseTime } from "./parsers.ts";
import {
  classifyBiometricResult,
  classifyNotificationResult,
  classifySignatureResult,
  formatSignatureResultRaw,
  normalizeSheetOpsText,
  type OperationalResultClass,
} from "./operational-result-classifiers.ts";
import {
  evaluateOperationalRedFlags,
  EMPTY_OPERATIONAL_RED_FLAGS,
  type EffectiveBackground,
  type EffectiveBackgroundGrid,
} from "./effective-background.ts";
import { detectInscripcionRebookRequirement } from "./inscripcion-rebook.ts";

export type OperationalResultUpsertRow = {
  organization_id: string;
  spreadsheet_id: string;
  sheet_id: number;
  sheet_title: string;
  booking_date: string;
  sheet_row: number;
  kind: string;
  location_id: string;
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
  inscripcion_rebook_required: boolean;
  inscripcion_rebook_reason_raw: string | null;
};

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

function inscripcionRebookFields(input: {
  kind: string;
  notificationRaw: string | null;
}): {
  inscripcion_rebook_required: boolean;
  inscripcion_rebook_reason_raw: string | null;
} {
  if (input.kind !== "biometricos") {
    return {
      inscripcion_rebook_required: false,
      inscripcion_rebook_reason_raw: null,
    };
  }
  const required = detectInscripcionRebookRequirement(input.notificationRaw);
  return {
    inscripcion_rebook_required: required,
    inscripcion_rebook_reason_raw: required ? input.notificationRaw : null,
  };
}

function isHoraHeader(a: string): boolean {
  const n = a
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  return n === "HORA" || n.startsWith("HORA");
}

/** Índice 0-based de columna NOTAS, o null. */
export function findNotasColumnIndex(
  headerRow: ReadonlyArray<string | null | undefined> | null | undefined,
): number | null {
  if (!headerRow || headerRow.length === 0) return null;
  for (let i = 0; i < headerRow.length; i++) {
    if (normalizeSheetOpsText(cell(headerRow, i)) === "NOTAS") return i;
  }
  return null;
}

/**
 * notes_raw descriptivo. Header NOTAS gana; fallback bio H=7 / firmas H luego I.
 * No altera classifiers.
 */
export function extractOperationalNote(input: {
  kind: string;
  row: ReadonlyArray<string | null | undefined>;
  headerRow?: ReadonlyArray<string | null | undefined> | null;
}): string | null {
  const fromHeader = findNotasColumnIndex(input.headerRow);
  if (fromHeader != null) return nullIfEmpty(cell(input.row, fromHeader));
  const kind = String(input.kind ?? "").trim().toLowerCase();
  if (kind === "biometricos") return nullIfEmpty(cell(input.row, 7));
  return nullIfEmpty(cell(input.row, 7)) ?? nullIfEmpty(cell(input.row, 8));
}

export function extractFirmoFirmaCells(
  row: ReadonlyArray<string | null | undefined>,
): { firmo: string; firma: string } {
  return {
    firmo: cell(row, 5),
    firma: cell(row, 6),
  };
}

export function extractSignatureResultRaw(
  row: ReadonlyArray<string | null | undefined>,
): string {
  const { firmo, firma } = extractFirmoFirmaCells(row);
  return formatSignatureResultRaw(firmo, firma) ?? "";
}

export function classifyOperationalRow(input: {
  kind: string;
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
    notification_result_class: "PENDING",
    notification_result_raw: null,
    signature_result_class: classifySignatureResult(firmo, firma),
    signature_result_raw: formatSignatureResultRaw(firmo, firma),
  };
}

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
  let section: { kind: string; location_id: string } | null = null;
  let headerRow: ReadonlyArray<string | null | undefined> | null = null;

  for (let i = 0; i < input.grid.length; i++) {
    const row = input.grid[i] ?? [];
    const a = cell(row, 0);
    const sec = parseSection(a);
    if (sec) {
      section = { kind: sec.kind, location_id: sec.sede };
      headerRow = null;
      continue;
    }
    if (!section) continue;
    // P175: sección inscripción es inventario/agenda; no proyecta KPIs bio/firmas.
    if (section.kind === "inscripcion") continue;
    if (isHoraHeader(a)) {
      headerRow = row;
      continue;
    }

    let slotTime: string | null = null;
    if (a) {
      const slot = parseTime(a);
      if (!slot) continue;
      slotTime = slot;
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
      booking_id: asUuidOrNull(cell(row, 15)),
      expediente_id: asUuidOrNull(cell(row, 16)),
      ...classified,
      ...inscripcionRebookFields({
        kind: section.kind,
        notificationRaw: classified.notification_result_raw,
      }),
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

/** Una fila: requiere kind/location conocidos (p.ej. desde inventario). */
export function buildOperationalResultFromRow(input: {
  organizationId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  sheetRow: number;
  kind: string;
  locationId: string;
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
    const slot = parseTime(a);
    if (!slot) return null;
    slotTime = slot;
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
    ...inscripcionRebookFields({
      kind: input.kind,
      notificationRaw: classified.notification_result_raw,
    }),
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
