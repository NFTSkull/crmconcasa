/**
 * Edge mirror: proyección resultados operativos CITAS 2026.
 */
import { parseSection, parseTime } from "./parsers.ts";
import {
  classifyBiometricResult,
  classifyNotificationResult,
  classifySignatureResult,
  formatSignatureResultRaw,
  type OperationalResultClass,
} from "./operational-result-classifiers.ts";

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

function isHoraHeader(a: string): boolean {
  const n = a
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  return n === "HORA" || n.startsWith("HORA");
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
}): OperationalResultUpsertRow[] {
  const out: OperationalResultUpsertRow[] = [];
  let section: { kind: string; location_id: string } | null = null;

  for (let i = 0; i < input.grid.length; i++) {
    const row = input.grid[i] ?? [];
    const a = cell(row, 0);
    const sec = parseSection(a);
    if (sec) {
      section = { kind: sec.kind, location_id: sec.sede };
      continue;
    }
    if (!section) continue;
    if (isHoraHeader(a)) continue;

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
  };
}
