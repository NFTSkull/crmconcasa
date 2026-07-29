/**
 * Mirror de src/domain/agenda-sheets/resolve-tab.ts — mantener en sync.
 */

import { parseTabDate } from "./parsers.ts";

export type SheetTabMeta = {
  sheetId: number;
  title: string;
  hidden?: boolean;
};

export type AgendaSheetTabMap = Record<string, { sheetId: number; title: string }>;

export type ResolveSheetTabResult =
  | { status: "resolved_from_tab_map"; sheetId: number; title: string }
  | { status: "resolved_from_live_metadata"; sheetId: number; title: string }
  | { status: "missing_sheet_for_date"; bookingDate: string }
  | {
    status: "ambiguous_sheet_for_date";
    bookingDate: string;
    titles: string[];
  };

function yearFromBookingDate(bookingDate: string): number | null {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(bookingDate ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isInteger(y) ? y : null;
}

export function parseTabMapJson(raw: string | null | undefined): AgendaSheetTabMap {
  try {
    const parsed = JSON.parse(String(raw ?? "{}")) as AgendaSheetTabMap;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function resolveSheetTabForDate(input: {
  bookingDate: string;
  tabMap: AgendaSheetTabMap;
  liveTabs: ReadonlyArray<SheetTabMeta>;
  year?: number;
}): ResolveSheetTabResult {
  const bookingDate = String(input.bookingDate ?? "").trim();
  const mapped = input.tabMap[bookingDate];
  if (
    mapped &&
    Number.isFinite(Number(mapped.sheetId)) &&
    String(mapped.title ?? "").length > 0
  ) {
    return {
      status: "resolved_from_tab_map",
      sheetId: Number(mapped.sheetId),
      title: String(mapped.title),
    };
  }

  const year = input.year ?? yearFromBookingDate(bookingDate);
  if (year == null) {
    return { status: "missing_sheet_for_date", bookingDate };
  }

  const matches: SheetTabMeta[] = [];
  for (const tab of input.liveTabs) {
    if (tab.hidden) continue;
    const titleExact = String(tab.title ?? "");
    if (titleExact.trim().toUpperCase() === "FORMATO") continue;
    const parsed = parseTabDate(titleExact, year);
    if (!parsed) continue;
    if (parsed !== bookingDate) continue;
    matches.push(tab);
  }

  if (matches.length === 0) {
    return { status: "missing_sheet_for_date", bookingDate };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous_sheet_for_date",
      bookingDate,
      titles: matches.map((m) => m.title),
    };
  }
  const hit = matches[0]!;
  return {
    status: "resolved_from_live_metadata",
    sheetId: hit.sheetId,
    title: hit.title,
  };
}
