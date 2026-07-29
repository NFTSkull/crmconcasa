/**
 * Dry-run de diagnóstico Agenda ↔ Sheets.
 * Solo lectura en memoria; no escribe Sheets ni Supabase.
 */

import {
  enumerateSheetSlots,
  normalizeSheetNss,
  parseSheetTabDate,
  type AgendaSheetKind,
  type AgendaSheetSede,
  type SheetSlotRow,
} from "./parsers";

export type DryRunCrmBooking = Readonly<{
  id: string;
  kind: AgendaSheetKind;
  bookingDate: string;
  bookingTime: string;
  locationId: AgendaSheetSede;
  nss: string | null;
  status: "booked" | "cancelled";
}>;

export type DryRunTabInput = Readonly<{
  title: string;
  sheetId: number;
  rows: ReadonlyArray<ReadonlyArray<string>>;
}>;

export type AgendaSheetsDryRunReport = Readonly<{
  year: number;
  tabsUnrecognized: string[];
  slots: SheetSlotRow[];
  invalidNss: Array<{ tab: string; rowNumber: number; raw: string }>;
  sheetOccupiedNotInCrm: Array<{
    tab: string;
    rowNumber: number;
    nss: string;
    slotKey: string;
  }>;
  crmBookedNotInSheet: Array<{ bookingId: string; slotKey: string; nss: string | null }>;
  bothOccupied: Array<{ nss: string; slotKey: string; bookingId: string; rowNumber: number }>;
  duplicateNssInSheet: string[];
  ambiguousRows: Array<{ tab: string; rowNumber: number; reason: string }>;
}>;

function slotKeyOf(s: {
  kind: AgendaSheetKind;
  date: string;
  time: string;
  sede: AgendaSheetSede;
}): string {
  return `${s.kind}|${s.date}|${s.time}|${s.sede}`;
}

export function buildAgendaSheetsDryRunReport(input: {
  year: number;
  tabs: DryRunTabInput[];
  crmBookings: DryRunCrmBooking[];
}): AgendaSheetsDryRunReport {
  const tabsUnrecognized: string[] = [];
  const slots: SheetSlotRow[] = [];
  const invalidNss: AgendaSheetsDryRunReport["invalidNss"] = [];
  const sheetOccupied: Array<{
    tab: string;
    rowNumber: number;
    nss: string;
    slotKey: string;
  }> = [];
  const nssCounts = new Map<string, number>();
  const ambiguousRows: AgendaSheetsDryRunReport["ambiguousRows"] = [];

  for (const tab of input.tabs) {
    const date = parseSheetTabDate(tab.title, input.year);
    if (!date.ok) {
      tabsUnrecognized.push(tab.title);
      continue;
    }
    const enumerated = enumerateSheetSlots({
      sheetDate: date.value,
      rows: tab.rows,
      startRowNumber: 1,
    });
    for (const s of enumerated) {
      slots.push(s);
      const nssRaw = s.nssRaw.trim();
      if (!nssRaw) continue;
      const nss = normalizeSheetNss(nssRaw);
      if (!nss.ok) {
        invalidNss.push({ tab: tab.title, rowNumber: s.rowNumber, raw: nssRaw });
        ambiguousRows.push({
          tab: tab.title,
          rowNumber: s.rowNumber,
          reason: nss.error,
        });
        continue;
      }
      nssCounts.set(nss.value, (nssCounts.get(nss.value) ?? 0) + 1);
      sheetOccupied.push({
        tab: tab.title,
        rowNumber: s.rowNumber,
        nss: nss.value,
        slotKey: slotKeyOf({
          kind: s.kind,
          date: date.value,
          time: s.slotTime,
          sede: s.sede,
        }),
      });
    }
  }

  const crmActive = input.crmBookings.filter((b) => b.status === "booked");
  const crmByNss = new Map(
    crmActive.filter((b) => b.nss).map((b) => [String(b.nss), b] as const),
  );

  const sheetOccupiedNotInCrm = sheetOccupied.filter((s) => !crmByNss.has(s.nss));
  const sheetNssSet = new Set(sheetOccupied.map((s) => s.nss));
  const crmBookedNotInSheet = crmActive
    .filter((b) => b.nss && !sheetNssSet.has(b.nss))
    .map((b) => ({
      bookingId: b.id,
      nss: b.nss,
      slotKey: slotKeyOf({
        kind: b.kind,
        date: b.bookingDate,
        time: b.bookingTime.slice(0, 5),
        sede: b.locationId,
      }),
    }));

  const bothOccupied: AgendaSheetsDryRunReport["bothOccupied"] = [];
  for (const s of sheetOccupied) {
    const b = crmByNss.get(s.nss);
    if (!b) continue;
    bothOccupied.push({
      nss: s.nss,
      slotKey: s.slotKey,
      bookingId: b.id,
      rowNumber: s.rowNumber,
    });
  }

  const duplicateNssInSheet = [...nssCounts.entries()]
    .filter(([, c]) => c > 1)
    .map(([nss]) => nss);

  return {
    year: input.year,
    tabsUnrecognized,
    slots,
    invalidNss,
    sheetOccupiedNotInCrm,
    crmBookedNotInSheet,
    bothOccupied,
    duplicateNssInSheet,
    ambiguousRows,
  };
}
