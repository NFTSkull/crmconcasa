import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReconcileBookingReport,
  buildRepairPlan,
  extractSheetBookingOccurrences,
} from "./reconcile-booking-entries";
import { AGENDA_SHEET_COL_INDEX } from "./tech-columns";

function rowWithBooking(opts: {
  hora?: string;
  bookingId: string;
  expedienteId?: string;
  slotKey?: string;
}): string[] {
  const r = Array.from({ length: 21 }, () => "");
  r[AGENDA_SHEET_COL_INDEX.hora] = opts.hora ?? "10:00";
  r[AGENDA_SHEET_COL_INDEX.nss] = "HIDDEN"; // no se usa en clasificación
  r[AGENDA_SHEET_COL_INDEX.nombre] = "HIDDEN";
  r[AGENDA_SHEET_COL_INDEX.bookingId] = opts.bookingId;
  r[AGENDA_SHEET_COL_INDEX.expedienteId] = opts.expedienteId ?? "exp-1";
  r[AGENDA_SHEET_COL_INDEX.slotKey] =
    opts.slotKey ?? "biometricos|2026-08-03|10:00|monterrey";
  r[AGENDA_SHEET_COL_INDEX.syncSource] = "crm";
  return r;
}

describe("reconcile-booking-entries dry-run", () => {
  it("MATCHED cuando booking activo coincide en Sheet", () => {
    const occ = extractSheetBookingOccurrences({
      year: 2026,
      tabs: [
        {
          title: "03 AGOSTO ",
          sheetId: 1,
          rows: [
            rowWithBooking({
              bookingId: "b-active",
              hora: "10:00",
            }),
          ],
        },
      ],
    });
    const report = buildReconcileBookingReport({
      crmBookings: [
        {
          id: "b-active",
          expedienteId: "exp-1",
          kind: "biometricos",
          status: "booked",
          bookingDate: "2026-08-03",
          bookingTime: "10:00:00",
          locationId: "monterrey",
        },
      ],
      sheetOccurrences: occ,
    });
    assert.equal(report.counts.MATCHED, 1);
    assert.equal(report.counts.STALE_SHEET_ENTRY, 0);
  });

  it("STALE_SHEET_ENTRY: cancelado en DB aún visible en Sheet", () => {
    const occ = extractSheetBookingOccurrences({
      year: 2026,
      tabs: [
        {
          title: "03 AGOSTO ",
          sheetId: 1,
          rows: [rowWithBooking({ bookingId: "b-old", hora: "09:00" })],
        },
      ],
    });
    const report = buildReconcileBookingReport({
      crmBookings: [
        {
          id: "b-old",
          expedienteId: "exp-1",
          kind: "biometricos",
          status: "cancelled",
          bookingDate: "2026-08-03",
          bookingTime: "09:00:00",
          locationId: "monterrey",
        },
        {
          id: "b-new",
          expedienteId: "exp-1",
          kind: "biometricos",
          status: "booked",
          bookingDate: "2026-08-04",
          bookingTime: "10:00:00",
          locationId: "monterrey",
        },
      ],
      sheetOccurrences: occ,
    });
    assert.ok(report.counts.STALE_SHEET_ENTRY >= 1);
    assert.ok(report.counts.MISSING_SHEET_ENTRY >= 1);
    const repair = buildRepairPlan(report);
    assert.ok(repair.some((r) => r.action === "clear_stale_sheet_row"));
  });

  it("DUPLICATE_SHEET_ENTRY: mismo booking UUID en dos filas", () => {
    const occ = extractSheetBookingOccurrences({
      year: 2026,
      tabs: [
        {
          title: "03 AGOSTO ",
          sheetId: 1,
          rows: [
            rowWithBooking({ bookingId: "b-dup", hora: "09:00" }),
            rowWithBooking({ bookingId: "b-dup", hora: "10:00" }),
          ],
        },
      ],
    });
    const report = buildReconcileBookingReport({
      crmBookings: [
        {
          id: "b-dup",
          expedienteId: "exp-1",
          kind: "firmas",
          status: "booked",
          bookingDate: "2026-08-03",
          bookingTime: "10:00:00",
          locationId: "monterrey",
        },
      ],
      sheetOccurrences: occ,
    });
    assert.ok(report.counts.DUPLICATE_SHEET_ENTRY >= 1);
  });

  it("MISSING_SHEET_ENTRY: activo en DB sin P en Sheet", () => {
    const report = buildReconcileBookingReport({
      crmBookings: [
        {
          id: "b-miss",
          expedienteId: "exp-2",
          kind: "firmas",
          status: "booked",
          bookingDate: "2026-08-05",
          bookingTime: "11:00:00",
          locationId: "apodaca",
        },
      ],
      sheetOccurrences: [],
    });
    assert.equal(report.counts.MISSING_SHEET_ENTRY, 1);
  });

  it("repair no toca AMBIGUOUS", () => {
    const report = buildReconcileBookingReport({
      crmBookings: [],
      sheetOccurrences: [
        {
          bookingId: "orphan-uuid",
          expedienteId: "exp-x",
          kind: "biometricos",
          tabTitle: "03 AGOSTO ",
          sheetId: 1,
          rowNumber: 12,
          sheetDate: "2026-08-03",
          sheetTime: "08:00",
          syncSource: "crm",
          estado: "SINCRONIZADO",
          isRescheduledHistory: false,
        },
      ],
    });
    assert.equal(report.counts.AMBIGUOUS, 1);
    assert.equal(buildRepairPlan(report).length, 0);
  });

  it("RESCHEDULED_HISTORY: P=prior UUID no se repara como stale", () => {
    const r = rowWithBooking({ bookingId: "b-old", hora: "09:00" });
    r[AGENDA_SHEET_COL_INDEX.estado] = "REAGENDADO";
    const occ = extractSheetBookingOccurrences({
      year: 2026,
      tabs: [{ title: "03 AGOSTO ", sheetId: 1, rows: [r] }],
    });
    assert.equal(occ[0]?.isRescheduledHistory, true);
    const report = buildReconcileBookingReport({
      crmBookings: [
        {
          id: "b-old",
          expedienteId: "exp-1",
          kind: "biometricos",
          status: "cancelled",
          bookingDate: "2026-08-03",
          bookingTime: "09:00:00",
          locationId: "monterrey",
        },
        {
          id: "b-new",
          expedienteId: "exp-1",
          kind: "biometricos",
          status: "booked",
          bookingDate: "2026-08-04",
          bookingTime: "10:00:00",
          locationId: "monterrey",
        },
      ],
      sheetOccurrences: occ,
    });
    assert.equal(report.counts.STALE_SHEET_ENTRY, 0);
    assert.equal(buildRepairPlan(report).length, 0);
    assert.ok(report.findings.every((f) => f.proposedAction === "none" || f.proposedAction === "enqueue_created_sync"));
  });

  it("no clasifica por nombre (fila sin P se ignora)", () => {
    const r = Array.from({ length: 21 }, () => "");
    r[AGENDA_SHEET_COL_INDEX.nombre] = "Cliente Fantasma";
    r[AGENDA_SHEET_COL_INDEX.nss] = "12345678901";
    const occ = extractSheetBookingOccurrences({
      year: 2026,
      tabs: [{ title: "03 AGOSTO ", sheetId: 1, rows: [r] }],
    });
    assert.equal(occ.length, 0);
  });
});
