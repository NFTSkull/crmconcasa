/**
 * Inventario físico Sheet → estados de cupo CRM.
 * Una fila A con hora dentro de sección = un cupo físico.
 */

import { inventoryStatusFromSheetRow } from "./cancel-row-clearance";
import { parseSheetSectionHeader, parseSheetTime } from "./parsers";
import {
  isPlausibleTimeForSection,
  resolveOrphanSection,
  type SectionHintByRow,
  type SheetSectionRef,
} from "./section-recovery";
import {
  buildPhysicalSheetRowKey,
  resolveLogicalStartTime,
  type AgendaSheetTimeAlias,
} from "./time-aliases";

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
  kind: "biometricos" | "firmas" | "inscripcion";
  locationId: "monterrey" | "apodaca";
  /** Horario lógico CRM (post-alias). */
  slotTime: string;
  /** Horario físico columna A del Sheet. */
  sheetSlotTime: string;
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
  code:
    | "INVALID_OR_MISSING_SECTION_HEADER"
    | "UNPARSED_TIME_IN_SECTION"
    | "MANUAL_ENTRY_WITHOUT_SLOT";
  sheetRow: number;
  message: string;
}>;

const NO_HAY_CITAS_RE = /^NO\s+HAY\s+CITAS\b/i;

function cell(row: readonly string[] | undefined, idx: number): string {
  return String(row?.[idx] ?? "").trim();
}

type OrphanBuf = {
  sheetRow: number;
  row: readonly string[];
  sheetSlotTime: string;
};

/**
 * Clasifica filas A1:U de una pestaña de fecha operativa.
 * Si falta el encabezado (p.ej. A1 vacío), recupera la sección con layout/hints
 * sin mezclar Apodaca↔Monterrey.
 */
export function parsePhysicalInventoryFromGrid(params: {
  bookingDate: string;
  sheetTitle: string;
  /** sheetId de la pestaña (identidad física canónica). */
  sheetId?: number;
  grid: readonly (readonly string[])[];
  timeAliases?: readonly AgendaSheetTimeAlias[];
  /** Inventario previo por sheet_row → sección (rehidratación). */
  sectionHints?: SectionHintByRow;
}): { rows: ParsedPhysicalSlotRow[]; issues: SheetInventoryParseIssue[] } {
  const { bookingDate, grid } = params;
  const sheetId = params.sheetId ?? 0;
  const aliases = params.timeAliases ?? [];
  const hints = params.sectionHints;
  const rows: ParsedPhysicalSlotRow[] = [];
  const issues: SheetInventoryParseIssue[] = [];

  let section: SheetSectionRef | null = null;
  let orphans: OrphanBuf[] = [];
  let orphanPrevSection: SheetSectionRef | null = null;

  const emitSlot = (
    sheetRow: number,
    row: readonly string[],
    sheetSlotTime: string,
    sec: SheetSectionRef,
    headerMissing: boolean,
  ) => {
    const logicalSlotTime = resolveLogicalStartTime({
      aliases,
      locationId: sec.sede,
      kind: sec.kind,
      sheetStartTime: sheetSlotTime,
    });
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
      advisor,
      techBookingId: techBookingIdRaw,
      techEstado,
    }) as InventoryRowStatus;
    const estadoUpper = String(techEstado ?? "").toUpperCase();
    const cancelledMeta = estadoUpper === "CANCELADA";
    const historyMeta =
      estadoUpper === "REAGENDADO" || estadoUpper === "RESCHEDULED_HISTORY";
    const detachMeta = cancelledMeta || historyMeta;
    const techBookingId = detachMeta ? null : techBookingIdRaw;
    const techExpedienteId = detachMeta ? null : techExpedienteIdRaw;
    const techSlotKey = detachMeta ? null : techSlotKeyRaw;

    rows.push({
      sheetRow,
      bookingDate,
      kind: sec.kind,
      locationId: sec.sede,
      slotTime: logicalSlotTime,
      sheetSlotTime,
      slotKey: buildPhysicalSheetRowKey({
        kind: sec.kind,
        bookingDate,
        logicalStartTime: logicalSlotTime,
        sheetStartTime: sheetSlotTime,
        locationId: sec.sede,
        sheetId,
        rowNumber: sheetRow,
      }),
      status,
      visibleNss: detachMeta ? null : nss || null,
      visibleName: detachMeta ? null : name || null,
      visibleAdvisor: detachMeta ? null : advisor || null,
      techBookingId,
      techExpedienteId,
      techSlotKey,
      sectionHeaderMissing: headerMissing,
      disabledReason: historyMeta ? "rescheduled_history" : null,
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
        emitSlot(o.sheetRow, o.row, o.sheetSlotTime, resolved, true);
      }
      section = resolved;
    } else {
      for (const o of orphans) {
        issues.push({
          code: "INVALID_OR_MISSING_SECTION_HEADER",
          sheetRow: o.sheetRow,
          message: `Hora ${o.sheetSlotTime} sin encabezado de sección válido (p.ej. 04 AGOSTO A1 vacío)`,
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
          sheetRow,
          message:
            "Fila con NSS/nombre/asesor sin HORA: anomalía (no consume cupo hasta asignar horario)",
        });
      }
      continue;
    }

    if (NO_HAY_CITAS_RE.test(a)) {
      flushOrphans(section);
      if (section) {
        rows.push({
          sheetRow,
          bookingDate,
          kind: section.kind,
          locationId: section.sede,
          slotTime: "00:00",
          sheetSlotTime: "00:00",
          slotKey: `${section.kind}|${bookingDate}|disabled|${section.sede}|sheetId=${sheetId}|row=${sheetRow}`,
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
      flushOrphans(parsedSection.value);
      section = parsedSection.value;
      continue;
    }

    const t = parseSheetTime(a);
    if (!t.ok) continue;

    if (!section) {
      if (orphans.length === 0) orphanPrevSection = null;
      orphans.push({ sheetRow, row, sheetSlotTime: t.value });
      continue;
    }

    // Inscripción: hora alien (≠11:00) no es cupo; no romper sección ni corregir A.
    if (section.kind === "inscripcion" && t.value !== "11:00") {
      issues.push({
        code: "UNPARSED_TIME_IN_SECTION",
        sheetRow,
        message: `Hora ${t.value} en sección inscripción ignorada (solo 11:00 es cupo)`,
      });
      continue;
    }

    if (!isPlausibleTimeForSection(section, t.value)) {
      // Cambio de bloque sin encabezado (p.ej. 10:30 Apodaca tras Monterrey sticky).
      if (orphans.length === 0) orphanPrevSection = section;
      orphans.push({ sheetRow, row, sheetSlotTime: t.value });
      section = null;
      continue;
    }

    emitSlot(sheetRow, row, t.value, section, false);
  }

  flushOrphans(null);

  return { rows, issues };
}

/** effective_available = min(configRemaining, inventoryAvailable) */
export function effectiveSheetAwareRemaining(params: {
  configRemaining: number;
  inventoryAvailable: number | null;
  inventoryFresh: boolean;
  inventoryEnforced: boolean;
  dailyRemaining?: number | null;
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
  let remaining = Math.min(
    configRemaining,
    Math.max(0, params.inventoryAvailable),
  );
  if (params.dailyRemaining != null) {
    remaining = Math.min(remaining, Math.max(0, Math.trunc(params.dailyRemaining)));
  }
  return {
    remaining,
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
