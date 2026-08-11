/**
 * Reconciliación READ-ONLY CRM↔Sheets por booking UUID (columna P).
 * Clasifica STALE / DUPLICATE / MISSING / MATCHED / AMBIGUOUS.
 * Sin PII: solo IDs técnicos + kind + fechas/horas + acción propuesta.
 */

import { AGENDA_SHEET_COL_INDEX } from "./tech-columns.ts";
import { parseSheetTabDate, type AgendaSheetKind } from "./parsers.ts";
import { isRescheduledHistoryEstado } from "./rescheduled-history.ts";

export type ReconcileCrmBooking = Readonly<{
  id: string;
  expedienteId: string;
  kind: AgendaSheetKind;
  status: "booked" | "cancelled";
  bookingDate: string;
  bookingTime: string;
  locationId: string;
}>;

export type ReconcileSheetOccurrence = Readonly<{
  bookingId: string;
  expedienteId: string | null;
  kind: AgendaSheetKind | null;
  tabTitle: string;
  sheetId: number;
  rowNumber: number;
  sheetDate: string | null;
  sheetTime: string | null;
  syncSource: string | null;
  estado: string | null;
  isRescheduledHistory: boolean;
}>;

export type ReconcileClassification =
  | "MATCHED"
  | "STALE_SHEET_ENTRY"
  | "DUPLICATE_SHEET_ENTRY"
  | "MISSING_SHEET_ENTRY"
  | "AMBIGUOUS";

export type ReconcileFinding = Readonly<{
  classification: ReconcileClassification;
  bookingId: string | null;
  expedienteId: string | null;
  kind: AgendaSheetKind | null;
  dbDateTime: string | null;
  sheetDateTime: string | null;
  sheetTab: string | null;
  sheetRow: number | null;
  proposedAction:
    | "none"
    | "clear_stale_sheet_row"
    | "clear_duplicate_keep_active"
    | "enqueue_created_sync"
    | "manual_review";
}>;

export type ReconcileBookingReport = Readonly<{
  findings: ReconcileFinding[];
  counts: Record<ReconcileClassification, number>;
}>;

function cell(
  row: ReadonlyArray<string | null | undefined>,
  idx: number,
): string {
  return String(row[idx] ?? "").trim();
}

/** Extrae ocurrencias Sheet con CRM_BOOKING_ID (P) sin usar nombre/NSS. */
export function extractSheetBookingOccurrences(input: {
  year: number;
  tabs: ReadonlyArray<{
    title: string;
    sheetId: number;
    rows: ReadonlyArray<ReadonlyArray<string>>;
  }>;
}): ReconcileSheetOccurrence[] {
  const out: ReconcileSheetOccurrence[] = [];
  for (const tab of input.tabs) {
    const date = parseSheetTabDate(tab.title, input.year);
    const sheetDate = date.ok ? date.value : null;
    tab.rows.forEach((row, idx) => {
      const bookingId = cell(row, AGENDA_SHEET_COL_INDEX.bookingId);
      if (!bookingId) return;
      const kindRaw = cell(row, AGENDA_SHEET_COL_INDEX.slotKey);
      // slotKey suele ser kind|date|time|sede — no obligatorio para clasificar
      let kind: AgendaSheetKind | null = null;
      if (kindRaw.startsWith("biometricos")) kind = "biometricos";
      else if (kindRaw.startsWith("firmas")) kind = "firmas";
      const estado = cell(row, AGENDA_SHEET_COL_INDEX.estado) || null;
      out.push({
        bookingId,
        expedienteId: cell(row, AGENDA_SHEET_COL_INDEX.expedienteId) || null,
        kind,
        tabTitle: tab.title,
        sheetId: tab.sheetId,
        rowNumber: idx + 1,
        sheetDate,
        sheetTime: cell(row, AGENDA_SHEET_COL_INDEX.hora) || null,
        syncSource: cell(row, AGENDA_SHEET_COL_INDEX.syncSource) || null,
        estado,
        isRescheduledHistory: isRescheduledHistoryEstado(estado),
      });
    });
  }
  return out;
}

function dbDateTime(b: ReconcileCrmBooking): string {
  return `${b.bookingDate}T${b.bookingTime.slice(0, 5)}`;
}

function sheetDateTime(o: ReconcileSheetOccurrence): string | null {
  if (!o.sheetDate && !o.sheetTime) return null;
  return `${o.sheetDate ?? "?"}${o.sheetTime ? `T${o.sheetTime}` : ""}`;
}

/**
 * Dry-run: compara bookings CRM vs ocurrencias Sheet (por booking UUID).
 * No propone borrar ambiguos.
 */
export function buildReconcileBookingReport(input: {
  crmBookings: readonly ReconcileCrmBooking[];
  sheetOccurrences: readonly ReconcileSheetOccurrence[];
}): ReconcileBookingReport {
  const findings: ReconcileFinding[] = [];
  const byBookingSheet = new Map<string, ReconcileSheetOccurrence[]>();
  for (const o of input.sheetOccurrences) {
    const list = byBookingSheet.get(o.bookingId) ?? [];
    list.push(o);
    byBookingSheet.set(o.bookingId, list);
  }

  const active = input.crmBookings.filter((b) => b.status === "booked");
  const cancelled = input.crmBookings.filter((b) => b.status === "cancelled");
  const activeIds = new Set(active.map((b) => b.id));
  const cancelledIds = new Set(cancelled.map((b) => b.id));
  const crmById = new Map(input.crmBookings.map((b) => [b.id, b] as const));

  // Sheet occurrences
  for (const [bookingId, occs] of byBookingSheet) {
    if (occs.length > 1) {
      const historyOnly = occs.filter((o) => o.isRescheduledHistory);
      const activeOccs = occs.filter((o) => !o.isRescheduledHistory);
      if (activeOccs.length <= 1) {
        for (const o of historyOnly) {
          const crm = crmById.get(bookingId);
          findings.push({
            classification: "MATCHED",
            bookingId,
            expedienteId: o.expedienteId ?? crm?.expedienteId ?? null,
            kind: o.kind ?? crm?.kind ?? null,
            dbDateTime: crm ? dbDateTime(crm) : null,
            sheetDateTime: sheetDateTime(o),
            sheetTab: o.tabTitle,
            sheetRow: o.rowNumber,
            proposedAction: "none",
          });
        }
        if (activeOccs.length === 1) {
          const o = activeOccs[0]!;
          const crm = crmById.get(bookingId);
          findings.push({
            classification: crm?.status === "booked" ? "MATCHED" : "STALE_SHEET_ENTRY",
            bookingId,
            expedienteId: o.expedienteId ?? crm?.expedienteId ?? null,
            kind: o.kind ?? crm?.kind ?? null,
            dbDateTime: crm ? dbDateTime(crm) : null,
            sheetDateTime: sheetDateTime(o),
            sheetTab: o.tabTitle,
            sheetRow: o.rowNumber,
            proposedAction: crm?.status === "booked" ? "none" : "clear_stale_sheet_row",
          });
        }
        continue;
      }
      const crm = crmById.get(bookingId);
      const keep =
        crm?.status === "booked"
          ? occs.find(
              (o) =>
                o.sheetDate === crm.bookingDate &&
                (o.sheetTime ?? "").slice(0, 5) ===
                  crm.bookingTime.slice(0, 5),
            ) ?? occs[0]
          : null;
      for (const o of occs) {
        if (keep && o.rowNumber === keep.rowNumber && o.tabTitle === keep.tabTitle) {
          findings.push({
            classification: "MATCHED",
            bookingId,
            expedienteId: o.expedienteId ?? crm?.expedienteId ?? null,
            kind: o.kind ?? crm?.kind ?? null,
            dbDateTime: crm ? dbDateTime(crm) : null,
            sheetDateTime: sheetDateTime(o),
            sheetTab: o.tabTitle,
            sheetRow: o.rowNumber,
            proposedAction: "none",
          });
          continue;
        }
        findings.push({
          classification: "DUPLICATE_SHEET_ENTRY",
          bookingId,
          expedienteId: o.expedienteId ?? crm?.expedienteId ?? null,
          kind: o.kind ?? crm?.kind ?? null,
          dbDateTime: crm ? dbDateTime(crm) : null,
          sheetDateTime: sheetDateTime(o),
          sheetTab: o.tabTitle,
          sheetRow: o.rowNumber,
          proposedAction: keep
            ? "clear_duplicate_keep_active"
            : "manual_review",
        });
      }
      continue;
    }

    const o = occs[0]!;
    if (o.isRescheduledHistory) {
      const crm = crmById.get(bookingId);
      findings.push({
        classification: "MATCHED",
        bookingId,
        expedienteId: o.expedienteId ?? crm?.expedienteId ?? null,
        kind: o.kind ?? crm?.kind ?? null,
        dbDateTime: crm ? dbDateTime(crm) : null,
        sheetDateTime: sheetDateTime(o),
        sheetTab: o.tabTitle,
        sheetRow: o.rowNumber,
        proposedAction: "none",
      });
      continue;
    }
    if (activeIds.has(bookingId)) {
      const crm = crmById.get(bookingId)!;
      const timeMatch =
        o.sheetDate === crm.bookingDate &&
        (!o.sheetTime ||
          o.sheetTime.slice(0, 5) === crm.bookingTime.slice(0, 5));
      if (!timeMatch && o.sheetDate && o.sheetDate !== crm.bookingDate) {
        // Misma UUID en fecha distinta → stale vs active mismatch: ambiguo
        findings.push({
          classification: "AMBIGUOUS",
          bookingId,
          expedienteId: crm.expedienteId,
          kind: crm.kind,
          dbDateTime: dbDateTime(crm),
          sheetDateTime: sheetDateTime(o),
          sheetTab: o.tabTitle,
          sheetRow: o.rowNumber,
          proposedAction: "manual_review",
        });
      } else {
        findings.push({
          classification: "MATCHED",
          bookingId,
          expedienteId: crm.expedienteId,
          kind: crm.kind,
          dbDateTime: dbDateTime(crm),
          sheetDateTime: sheetDateTime(o),
          sheetTab: o.tabTitle,
          sheetRow: o.rowNumber,
          proposedAction: "none",
        });
      }
      continue;
    }

    if (cancelledIds.has(bookingId)) {
      const crm = crmById.get(bookingId)!;
      findings.push({
        classification: "STALE_SHEET_ENTRY",
        bookingId,
        expedienteId: crm.expedienteId,
        kind: crm.kind,
        dbDateTime: dbDateTime(crm),
        sheetDateTime: sheetDateTime(o),
        sheetTab: o.tabTitle,
        sheetRow: o.rowNumber,
        proposedAction: "clear_stale_sheet_row",
      });
      continue;
    }

    // UUID en Sheet sin booking conocido en el snapshot CRM
    findings.push({
      classification: "AMBIGUOUS",
      bookingId,
      expedienteId: o.expedienteId,
      kind: o.kind,
      dbDateTime: null,
      sheetDateTime: sheetDateTime(o),
      sheetTab: o.tabTitle,
      sheetRow: o.rowNumber,
      proposedAction: "manual_review",
    });
  }

  // Active CRM missing on Sheet
  for (const b of active) {
    if (byBookingSheet.has(b.id)) continue;
    findings.push({
      classification: "MISSING_SHEET_ENTRY",
      bookingId: b.id,
      expedienteId: b.expedienteId,
      kind: b.kind,
      dbDateTime: dbDateTime(b),
      sheetDateTime: null,
      sheetTab: null,
      sheetRow: null,
      proposedAction: "enqueue_created_sync",
    });
  }

  const counts: Record<ReconcileClassification, number> = {
    MATCHED: 0,
    STALE_SHEET_ENTRY: 0,
    DUPLICATE_SHEET_ENTRY: 0,
    MISSING_SHEET_ENTRY: 0,
    AMBIGUOUS: 0,
  };
  for (const f of findings) counts[f.classification]++;

  return { findings, counts };
}

/** Repair plan: solo stale/duplicate confirmados; nunca ambiguous. */
export function buildRepairPlan(
  report: ReconcileBookingReport,
): Array<{
  bookingId: string;
  sheetTab: string;
  sheetRow: number;
  action: "clear_stale_sheet_row" | "clear_duplicate_keep_active";
}> {
  const out: Array<{
    bookingId: string;
    sheetTab: string;
    sheetRow: number;
    action: "clear_stale_sheet_row" | "clear_duplicate_keep_active";
  }> = [];
  for (const f of report.findings) {
    if (
      f.proposedAction !== "clear_stale_sheet_row" &&
      f.proposedAction !== "clear_duplicate_keep_active"
    ) {
      continue;
    }
    if (!f.bookingId || !f.sheetTab || !(Number(f.sheetRow) > 0)) continue;
    if (f.classification === "AMBIGUOUS") continue;
    out.push({
      bookingId: f.bookingId,
      sheetTab: f.sheetTab,
      sheetRow: Number(f.sheetRow),
      action: f.proposedAction,
    });
  }
  return out;
}
