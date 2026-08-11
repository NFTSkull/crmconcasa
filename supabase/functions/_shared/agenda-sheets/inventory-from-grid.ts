/**
 * Construye filas de upsert para agenda_sheet_inventory_upsert_batch
 * desde una grilla A:U (mirror de src/domain/agenda-sheets/sheet-inventory.ts).
 */
import { parseSection, parseTime } from "./parsers.ts";
import {
  isPlausibleTimeForSection,
  resolveOrphanSection,
  type SectionHintByRow,
  type SheetSectionRef,
} from "./section-recovery.ts";
import {
  buildPhysicalSheetRowKey,
  resolveLogicalStartTime,
  type AgendaSheetTimeAlias,
} from "./time-aliases.ts";
import { manualOccupancyFingerprint } from "./manual-occupancy.ts";

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
  manual_occupancy_fingerprint?: string | null;
};

export type InventoryParseIssue = {
  code: string;
  sheet_row: number;
  message: string;
};

type OrphanBuf = {
  sheetRow: number;
  row: string[];
  sheetSlotTime: string;
};

export function buildInventoryUpsertRows(params: {
  organizationId: string;
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  bookingDate: string;
  grid: string[][];
  timeAliases?: readonly AgendaSheetTimeAlias[];
  sectionHints?: SectionHintByRow;
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
  const hints = params.sectionHints;
  const rows: InventoryUpsertRow[] = [];
  const issues: InventoryParseIssue[] = [];
  let section: SheetSectionRef | null = null;
  let orphans: OrphanBuf[] = [];
  let orphanPrevSection: SheetSectionRef | null = null;

  const emitSlot = (
    sheetRow: number,
    row: string[],
    sheetSlot: string,
    sec: SheetSectionRef,
  ) => {
    const logical = resolveLogicalStartTime({
      aliases,
      locationId: sec.sede,
      kind: sec.kind,
      sheetStartTime: sheetSlot,
    });
    const nss = cell(row, 1);
    const name = cell(row, 2);
    const advisor = cell(row, 3);
    const techEstado = cell(row, 14);
    const bookingIdRaw = asUuidOrNull(cell(row, 15) || null);
    const expedienteIdRaw = asUuidOrNull(cell(row, 16) || null);
    const estadoUpper = techEstado.toUpperCase();
    const cancelledMeta = estadoUpper === "CANCELADA";
    const historyMeta =
      estadoUpper === "REAGENDADO" || estadoUpper === "RESCHEDULED_HISTORY";
    const detachMeta = cancelledMeta || historyMeta;
    let status = "available";
    let occupancySource = "reconciliation";
    if (historyMeta) {
      status = "disabled";
      occupancySource = "reconciliation";
    } else if (cancelledMeta) {
      status = "available";
      occupancySource = "reconciliation";
    } else if (bookingIdRaw) {
      status = "linked";
      occupancySource = "crm";
    } else if (nss || name || advisor) {
      status = "occupied_external";
      occupancySource = "sheet_legacy";
    }
    const bookingId = detachMeta ? null : bookingIdRaw;
    const expedienteId = detachMeta ? null : expedienteIdRaw;
    const fingerprint =
      status === "occupied_external" && !detachMeta
        ? manualOccupancyFingerprint({ nss, name, advisor })
        : null;

    rows.push({
      organization_id: organizationId,
      spreadsheet_id: spreadsheetId,
      sheet_id: sheetId,
      sheet_title: sheetTitle,
      booking_date: bookingDate,
      sheet_row: sheetRow,
      kind: sec.kind,
      location_id: sec.sede,
      slot_time: `${logical}:00`,
      sheet_slot_time: `${sheetSlot}:00`,
      slot_key: buildPhysicalSheetRowKey({
        kind: sec.kind,
        bookingDate,
        logicalStartTime: logical,
        sheetStartTime: sheetSlot,
        locationId: sec.sede,
        sheetId,
        rowNumber: sheetRow,
      }),
      status,
      visible_nss: detachMeta ? null : nss || null,
      visible_name: detachMeta ? null : name || null,
      visible_advisor: detachMeta ? null : advisor || null,
      booking_id: bookingId,
      expediente_id: expedienteId,
      occupancy_source: occupancySource,
      manual_occupancy_fingerprint: fingerprint,
    });
  };

  const flushOrphans = (nextSection: SheetSectionRef | null) => {
    if (orphans.length === 0) return;
    const resolved = resolveOrphanSection({
      orphanTimes: orphans.map((o) => o.sheetSlotTime),
      orphanSheetRows: orphans.map((o) => o.sheetRow),
      nextSection,
      prevSection: orphanPrevSection,
      hints,
    });
    if (resolved) {
      for (const o of orphans) {
        emitSlot(o.sheetRow, o.row, o.sheetSlotTime, resolved);
      }
      section = resolved;
    } else {
      for (const o of orphans) {
        issues.push({
          code: "INVALID_OR_MISSING_SECTION_HEADER",
          sheet_row: o.sheetRow,
          message: `Hora ${o.sheetSlotTime} sin encabezado de sección`,
        });
      }
    }
    orphans = [];
    orphanPrevSection = null;
  };

  for (let i = 0; i < grid.length; i++) {
    const sheetRow = i + 1;
    const row = grid[i] ?? [];
    const a = cell(row, 0);
    if (!a) {
      const nssBlank = cell(row, 1);
      const nameBlank = cell(row, 2);
      const advisorBlank = cell(row, 3);
      if (nssBlank || nameBlank || advisorBlank) {
        issues.push({
          code: "MANUAL_ENTRY_WITHOUT_SLOT",
          sheet_row: sheetRow,
          message:
            "Fila con NSS/nombre/asesor sin HORA: no consume cupo hasta asignar horario",
        });
      }
      continue;
    }
    if (NO_HAY_CITAS_RE.test(a)) {
      flushOrphans(section);
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
    const secRaw = parseSection(a);
    const sec = secRaw
      ? ({
          sede: secRaw.sede,
          kind: secRaw.kind,
        } as SheetSectionRef)
      : null;
    if (sec) {
      flushOrphans(sec);
      section = sec;
      continue;
    }
    const t = parseTime(a);
    if (!t) continue;
    if (!section) {
      if (orphans.length === 0) orphanPrevSection = null;
      orphans.push({ sheetRow, row, sheetSlotTime: t });
      continue;
    }
    if (!isPlausibleTimeForSection(section, t)) {
      if (orphans.length === 0) orphanPrevSection = section;
      orphans.push({ sheetRow, row, sheetSlotTime: t });
      section = null;
      continue;
    }
    emitSlot(sheetRow, row, t, section);
  }
  flushOrphans(null);
  return { rows, issues };
}
