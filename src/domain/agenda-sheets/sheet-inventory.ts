/**
 * Inventario físico Sheet → estados de cupo CRM.
 * Una fila A con hora dentro de sección = un cupo físico.
 */

import { inventoryStatusFromSheetRow } from "./cancel-row-clearance";
import { parseSheetSectionHeader, parseSheetTime } from "./parsers";

export const AGENDA_SHEET_INVENTORY_START_DATE = "2026-07-30" as const;

export type InventoryRowStatus =
  | "available"
  | "occupied_external"
  | "claimed"
  | "linked"
  | "disabled"
  | "conflict";

export type InventoryOccupancySource =
  | "sheet_legacy"
  | "sheet_webhook"
  | "crm"
  | "reconciliation";

export type ParsedPhysicalSlotRow = Readonly<{
  sheetRow: number;
  bookingDate: string;
  kind: "biometricos" | "firmas";
  locationId: "monterrey" | "apodaca";
  slotTime: string;
  slotKey: string;
  status: InventoryRowStatus;
  visibleNss: string | null;
  visibleName: string | null;
  visibleAdvisor: string | null;
  techBookingId: string | null;
  techExpedienteId: string | null;
  techSlotKey: string | null;
  sectionHeaderMissing: boolean;
  disabledReason: string | null;
}>;

export type SheetInventoryParseIssue = Readonly<{
  code: "INVALID_OR_MISSING_SECTION_HEADER" | "UNPARSED_TIME_IN_SECTION";
  sheetRow: number;
  message: string;
}>;

const NO_HAY_CITAS_RE = /^NO\s+HAY\s+CITAS\b/i;

function cell(row: readonly string[] | undefined, idx: number): string {
  return String(row?.[idx] ?? "").trim();
}

function isBlankNameOrNss(nss: string, name: string): boolean {
  return !nss && !name;
}

/**
 * Clasifica filas A1:U de una pestaña de fecha operativa.
 */
export function parsePhysicalInventoryFromGrid(params: {
  bookingDate: string;
  sheetTitle: string;
  grid: readonly (readonly string[])[];
}): { rows: ParsedPhysicalSlotRow[]; issues: SheetInventoryParseIssue[] } {
  const { bookingDate, grid } = params;
  const rows: ParsedPhysicalSlotRow[] = [];
  const issues: SheetInventoryParseIssue[] = [];

  let section: { sede: "monterrey" | "apodaca"; kind: "biometricos" | "firmas" } | null =
    null;
  let sectionOrdinal = 0;
  let awaitingHeader = false;

  for (let i = 0; i < grid.length; i++) {
    const sheetRow = i + 1;
    const row = grid[i] ?? [];
    const a = cell(row, 0);

    if (!a) {
      if (section == null) {
        awaitingHeader = true;
      }
      continue;
    }

    if (NO_HAY_CITAS_RE.test(a)) {
      if (section) {
        sectionOrdinal += 1;
        rows.push({
          sheetRow,
          bookingDate,
          kind: section.kind,
          locationId: section.sede,
          slotTime: "00:00",
          slotKey: `${section.kind}|${bookingDate}|disabled|${section.sede}|${sectionOrdinal}`,
          status: "disabled",
          visibleNss: null,
          visibleName: null,
          visibleAdvisor: null,
          techBookingId: null,
          techExpedienteId: null,
          techSlotKey: null,
          sectionHeaderMissing: false,
          disabledReason: "NO_HAY_CITAS",
        });
      }
      continue;
    }

    const parsedSection = parseSheetSectionHeader(a);
    if (parsedSection.ok) {
      section = parsedSection.value;
      sectionOrdinal = 0;
      awaitingHeader = false;
      continue;
    }

    const t = parseSheetTime(a);
    if (!t.ok) continue;

    if (!section || awaitingHeader) {
      issues.push({
        code: "INVALID_OR_MISSING_SECTION_HEADER",
        sheetRow,
        message: `Hora ${t.value} sin encabezado de sección válido (p.ej. 04 AGOSTO A1 vacío)`,
      });
      awaitingHeader = false;
      continue;
    }

    sectionOrdinal += 1;
    const nss = cell(row, 1);
    const name = cell(row, 2);
    const advisor = cell(row, 3);
    const techEstado = cell(row, 14) || null;
    const techBookingIdRaw = cell(row, 15) || null;
    const techExpedienteIdRaw = cell(row, 16) || null;
    const techSlotKeyRaw = cell(row, 17) || null;
    const status = inventoryStatusFromSheetRow({
      nss,
      name,
      techBookingId: techBookingIdRaw,
      techEstado,
    }) as InventoryRowStatus;
    const cancelledMeta = String(techEstado ?? "").toUpperCase() === "CANCELADA";
    const techBookingId = cancelledMeta ? null : techBookingIdRaw;
    const techExpedienteId = cancelledMeta ? null : techExpedienteIdRaw;
    const techSlotKey = cancelledMeta ? null : techSlotKeyRaw;

    rows.push({
      sheetRow,
      bookingDate,
      kind: section.kind,
      locationId: section.sede,
      slotTime: t.value,
      slotKey: `${section.kind}|${bookingDate}|${t.value}|${section.sede}|${sectionOrdinal}`,
      status,
      visibleNss: cancelledMeta ? null : nss || null,
      visibleName: cancelledMeta ? null : name || null,
      visibleAdvisor: cancelledMeta ? null : advisor || null,
      techBookingId,
      techExpedienteId,
      techSlotKey,
      sectionHeaderMissing: false,
      disabledReason: null,
    });
  }

  return { rows, issues };
}

/** effective_available = min(configRemaining, inventoryAvailable) */
export function effectiveSheetAwareRemaining(params: {
  configRemaining: number;
  inventoryAvailable: number | null;
  inventoryFresh: boolean;
  inventoryEnforced: boolean;
}): { remaining: number; blockedReason: string | null } {
  const configRemaining = Math.max(0, Math.trunc(params.configRemaining));
  if (!params.inventoryEnforced) {
    return { remaining: configRemaining, blockedReason: null };
  }
  if (!params.inventoryFresh || params.inventoryAvailable == null) {
    return {
      remaining: 0,
      blockedReason: "Agenda temporalmente no disponible",
    };
  }
  return {
    remaining: Math.min(configRemaining, Math.max(0, params.inventoryAvailable)),
    blockedReason: null,
  };
}

export function isInventoryEnforcedDate(bookingDate: string): boolean {
  return bookingDate >= AGENDA_SHEET_INVENTORY_START_DATE;
}

/** Agrega conteos available por HH:mm desde filas parseadas. */
export function countAvailableByTime(
  rows: readonly ParsedPhysicalSlotRow[],
  kind: "biometricos" | "firmas",
  locationId: "monterrey" | "apodaca",
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.kind !== kind || r.locationId !== locationId) continue;
    if (r.status !== "available") continue;
    out[r.slotTime] = (out[r.slotTime] ?? 0) + 1;
  }
  return out;
}
