/**
 * P188: refresh de inventario Sheet → CRM para un horizonte de fechas.
 * Solo lecturas Google + agenda_sheet_inventory_upsert_batch.
 * Una tab con upsert_failed no aborta el resto (no marca fresh esa fecha).
 */
import { parseTabDate } from "./parsers.ts";
import { buildInventoryUpsertRows } from "./inventory-from-grid.ts";
import type { AgendaSheetTimeAlias } from "./time-aliases.ts";
import type { InventoryUpsertRow } from "./inventory-from-grid.ts";

export const AVAILABILITY_HORIZON_TZ = "America/Monterrey";
export const AVAILABILITY_HORIZON_DAYS = 60;
export const LIVE_SYNC_SCOPE_HORIZON = "horizon" as const;
export const GOOGLE_READ_STRATEGY = "BATCH_GET" as const;

const START = "2026-07-30";
const FORMATO_RE = /^FORMATO$/i;

export type HorizonTabMeta = {
  sheetId: number;
  title: string;
  hidden: boolean;
};

export type HorizonFailure = {
  date: string;
  code: string;
  tab: string;
};

export type HorizonTabOk = {
  date: string;
  tab: string;
  upserted: number;
  available: number;
};

export type HorizonRunResult = {
  from: string;
  to: string;
  tabs_seen: number;
  tabs_in_range: number;
  succeeded: number;
  failed: number;
  upserted: number;
  failures: HorizonFailure[];
  succeeded_tabs: HorizonTabOk[];
  list_sheets: number;
  batch_get: number;
  get_values: number;
  rpc_names: string[];
  outcome: "all_success" | "partial_success" | "all_tabs_failed";
};

export type HorizonAccess =
  | { kind: "single_date" }
  | { kind: "horizon" }
  | {
      kind: "reject";
      status: 400 | 401 | 403;
      code: string;
      message: string;
    };

export function ymdInTimeZone(
  now: Date,
  timeZone = AVAILABILITY_HORIZON_TZ,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addCalendarDaysYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

export function availabilityHorizonBounds(now: Date): { from: string; to: string } {
  const from = ymdInTimeZone(now, AVAILABILITY_HORIZON_TZ);
  return { from, to: addCalendarDaysYmd(from, AVAILABILITY_HORIZON_DAYS) };
}

export function isYmdInInclusiveRange(
  date: string,
  from: string,
  to: string,
): boolean {
  return date >= from && date <= to && date >= START;
}

export function a1TabGridRange(titleRaw: string): string {
  const titleEsc = `'${String(titleRaw).replace(/'/g, "''")}'`;
  return `${titleEsc}!A1:U200`;
}

export function decideLiveSyncScope(input: {
  scope: string | undefined;
  workerOk: boolean;
  userOk: boolean;
  mode: "availability" | "book_gate";
}): HorizonAccess {
  if (input.scope !== LIVE_SYNC_SCOPE_HORIZON) {
    return { kind: "single_date" };
  }
  if (!input.workerOk) {
    return {
      kind: "reject",
      status: input.userOk ? 403 : 401,
      code: "horizon_forbidden",
      message: "scope=horizon requiere worker secret",
    };
  }
  if (input.mode !== "availability") {
    return {
      kind: "reject",
      status: 400,
      code: "horizon_mode_invalid",
      message: "scope=horizon solo admite mode=availability",
    };
  }
  return { kind: "horizon" };
}

export function selectHorizonTabs(input: {
  tabs: readonly HorizonTabMeta[];
  from: string;
  to: string;
  year: number;
}): Array<HorizonTabMeta & { bookingDate: string }> {
  const out: Array<HorizonTabMeta & { bookingDate: string }> = [];
  for (const tab of input.tabs) {
    if (tab.hidden) continue;
    const titleRaw = String(tab.title ?? "");
    const titleCmp = titleRaw.trim();
    if (FORMATO_RE.test(titleCmp)) continue;
    const date = parseTabDate(titleCmp, input.year);
    if (!date) continue;
    if (!isYmdInInclusiveRange(date, input.from, input.to)) continue;
    out.push({ ...tab, title: titleRaw, bookingDate: date });
  }
  return out;
}

function sanitizeUpsertCode(message: string): string {
  const msg = String(message ?? "");
  if (/aparece en .+ filas físicas del mismo batch/i.test(msg)) {
    return "upsert_failed";
  }
  if (/upsert_failed/i.test(msg)) return "upsert_failed";
  return "upsert_failed";
}

export function horizonHttpStatus(result: HorizonRunResult): number {
  if (result.failed === 0) return 200;
  return 207;
}

export function horizonPublicBody(result: HorizonRunResult): Record<string, unknown> {
  return {
    scope: LIVE_SYNC_SCOPE_HORIZON,
    from: result.from,
    to: result.to,
    tabs_seen: result.tabs_seen,
    tabs_in_range: result.tabs_in_range,
    succeeded: result.succeeded,
    failed: result.failed,
    upserted: result.upserted,
    partial: result.failed > 0,
    outcome: result.outcome,
    failures: result.failures.map((f) => ({
      date: f.date,
      code: f.code,
    })),
  };
}

export async function runAvailabilityHorizon(input: {
  tabs: readonly HorizonTabMeta[];
  from: string;
  to: string;
  year: number;
  organizationId: string;
  spreadsheetId: string;
  timeAliases: readonly AgendaSheetTimeAlias[];
  batchGetValues: (rangesA1: readonly string[]) => Promise<Map<string, string[][]>>;
  upsertBatch: (
    rows: InventoryUpsertRow[],
  ) => Promise<{ error: { message?: string } | null }>;
}): Promise<HorizonRunResult> {
  const selected = selectHorizonTabs({
    tabs: input.tabs,
    from: input.from,
    to: input.to,
    year: input.year,
  });
  const ranges = selected.map((t) => a1TabGridRange(t.title));
  let batchGet = 0;
  let grids = new Map<string, string[][]>();
  if (ranges.length > 0) {
    grids = await input.batchGetValues(ranges);
    batchGet = 1;
  }

  const failures: HorizonFailure[] = [];
  const succeededTabs: HorizonTabOk[] = [];
  let upsertedTotal = 0;
  const rpcNames = ["agenda_sheet_inventory_upsert_batch"];

  for (const tab of selected) {
    const range = a1TabGridRange(tab.title);
    const grid = grids.get(range) ?? [];
    const { rows } = buildInventoryUpsertRows({
      organizationId: input.organizationId,
      spreadsheetId: input.spreadsheetId,
      sheetId: tab.sheetId,
      sheetTitle: tab.title,
      bookingDate: tab.bookingDate,
      grid,
      timeAliases: [...input.timeAliases],
    });
    let tabUpserted = 0;
    let failed = false;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      if (chunk.length === 0) continue;
      const { error } = await input.upsertBatch(chunk);
      if (error) {
        const code = sanitizeUpsertCode(String(error.message ?? ""));
        console.error("agenda-sheet-live-sync horizon tab failed", {
          date: tab.bookingDate,
          tab: tab.title.trim().slice(0, 40),
          code,
        });
        failures.push({
          date: tab.bookingDate,
          code,
          tab: tab.title.trim().slice(0, 40),
        });
        failed = true;
        break;
      }
      tabUpserted += chunk.length;
    }
    if (failed) continue;
    const available = rows.filter((r) => r.status === "available").length;
    upsertedTotal += tabUpserted;
    succeededTabs.push({
      date: tab.bookingDate,
      tab: tab.title.trim().slice(0, 40),
      upserted: tabUpserted,
      available,
    });
  }

  const failed = failures.length;
  const succeeded = succeededTabs.length;
  let outcome: HorizonRunResult["outcome"] = "all_success";
  if (failed > 0 && succeeded > 0) outcome = "partial_success";
  else if (failed > 0 && succeeded === 0) outcome = "all_tabs_failed";

  return {
    from: input.from,
    to: input.to,
    tabs_seen: input.tabs.length,
    tabs_in_range: selected.length,
    succeeded,
    failed,
    upserted: upsertedTotal,
    failures,
    succeeded_tabs: succeededTabs,
    list_sheets: 1,
    batch_get: batchGet,
    get_values: 0,
    rpc_names: rpcNames,
    outcome,
  };
}
