/**
 * Construye filas de upsert para agenda_sheet_inventory_upsert_batch
 * desde una grilla A:U (mirror de src/domain/agenda-sheets/sheet-inventory.ts).
 */
import { parseSection, parseTime } from "./parsers.ts";
import {
  buildPhysicalSheetRowKey,
  resolveLogicalStartTime,
  type AgendaSheetTimeAlias,
} from "./time-aliases.ts";

const NO_HAY_CITAS_RE = /^NO\s+HAY\s+CITAS\b/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cell(row: string[] | undefined, idx: number): string {
  return String(row?.[idx] ?? "").trim();
}

function asUuidOrNull(raw: string | null): string | null {
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw : null;
}

export type InventoryUpsertRow = {
  spreadsheet_id: string;
  sheet_id: number;
  sheet_title: string;
  booking_date: string;
  sheet_row: number;
  kind: string;
  location_id: string;
  /** Horario lógico CRM. */
  slot_time: string;
  /** Horario físico columna A. */
  sheet_slot_time: string;
  slot_key: string;
  status: string;
  visible_nss: string | null;
  visible_name: string | null;
  visible_advisor: string | null;
  booking_id: string | null;
  expediente_id: string | null;
  occupancy_source: string;
  organization_id: string;
};

export type InventoryParseIssue = {
  code: string;
  sheet_row: number;
  message: string;
};

export function buildInventoryUpsertRows(params: {
  organizationId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  grid: string[][];
  timeAliases?: readonly AgendaSheetTimeAlias[];
}): { rows: InventoryUpsertRow[]; issues: InventoryParseIssue[] } {
  const {
    organizationId,
    spreadsheetId,
    sheetId,
    sheetTitle,
    bookingDate,
    grid,
  } = params;
  const aliases = params.timeAliases ?? [];
  const rows: InventoryUpsertRow[] = [];
  const issues: InventoryParseIssue[] = [];
  let section: { sede: string; kind: string } | null = null;
  let awaitingHeader = false;

  for (let i = 0; i < grid.length; i++) {
    const sheetRow = i + 1;
    const row = grid[i] ?? [];
    const a = cell(row, 0);
    if (!a) {
      if (section == null) awaitingHeader = true;
      continue;
    }
    if (NO_HAY_CITAS_RE.test(a)) {
      if (section) {
        rows.push({
          organization_id: organizationId,
          spreadsheet_id: spreadsheetId,
          sheet_id: sheetId,
          sheet_title: sheetTitle,
          booking_date: bookingDate,
          sheet_row: sheetRow,
          kind: section.kind,
          location_id: section.sede,
          slot_time: "00:00:00",
          sheet_slot_time: "00:00:00",
          slot_key: `${section.kind}|${bookingDate}|disabled|${section.sede}|sheetId=${sheetId}|row=${sheetRow}`,
          status: "disabled",
          visible_nss: null,
          visible_name: null,
          visible_advisor: null,
          booking_id: null,
          expediente_id: null,
          occupancy_source: "reconciliation",
        });
      }
      continue;
    }
    const sec = parseSection(a);
    if (sec) {
      section = sec;
      awaitingHeader = false;
      continue;
    }
    const t = parseTime(a);
    if (!t) continue;
    if (!section || awaitingHeader) {
      issues.push({
        code: "INVALID_OR_MISSING_SECTION_HEADER",
        sheet_row: sheetRow,
        message: `Hora ${t} sin encabezado de sección`,
      });
      awaitingHeader = false;
      continue;
    }
    const sheetSlot = t;
    const logical = resolveLogicalStartTime({
      aliases,
      locationId: section.sede,
      kind: section.kind,
      sheetStartTime: sheetSlot,
    });
    const nss = cell(row, 1);
    const name = cell(row, 2);
    const advisor = cell(row, 3);
    const techEstado = cell(row, 14);
    const bookingIdRaw = asUuidOrNull(cell(row, 15) || null);
    const expedienteIdRaw = asUuidOrNull(cell(row, 16) || null);
    const cancelledMeta = techEstado.toUpperCase() === "CANCELADA";
    let status = "available";
    let occupancySource = "reconciliation";
    if (cancelledMeta) {
      status = "available";
      occupancySource = "reconciliation";
    } else if (bookingIdRaw) {
      status = "linked";
      occupancySource = "crm";
    } else if (nss || name) {
      status = "occupied_external";
      occupancySource = "sheet_legacy";
    }
    const bookingId = cancelledMeta ? null : bookingIdRaw;
    const expedienteId = cancelledMeta ? null : expedienteIdRaw;

    rows.push({
      organization_id: organizationId,
      spreadsheet_id: spreadsheetId,
      sheet_id: sheetId,
      sheet_title: sheetTitle,
      booking_date: bookingDate,
      sheet_row: sheetRow,
      kind: section.kind,
      location_id: section.sede,
      slot_time: `${logical}:00`,
      sheet_slot_time: `${sheetSlot}:00`,
      slot_key: buildPhysicalSheetRowKey({
        kind: section.kind,
        bookingDate,
        logicalStartTime: logical,
        sheetStartTime: sheetSlot,
        locationId: section.sede,
        sheetId,
        rowNumber: sheetRow,
      }),
      status,
      visible_nss: cancelledMeta ? null : nss || null,
      visible_name: cancelledMeta ? null : name || null,
      visible_advisor: cancelledMeta ? null : advisor || null,
      booking_id: bookingId,
      expediente_id: expedienteId,
      occupancy_source: occupancySource,
    });
  }
  return { rows, issues };
}
