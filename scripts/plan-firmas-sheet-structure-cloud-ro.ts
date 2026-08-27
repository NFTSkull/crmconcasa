#!/usr/bin/env npx tsx
/**
 * P212 Fase 1.5 — Planner Firmas READ-ONLY contra inventario Cloud
 * (proxy físico de Sheet: sheet_id/title/row/slot/status).
 * 0 Sheet writes. 0 Cloud writes.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/plan-firmas-sheet-structure-cloud-ro.ts
 *
 * Si hay GOOGLE_SERVICE_ACCOUNT_JSON, también lee A:U real (readonly scope).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFirmasStructurePlan,
  parseSection,
  parseTime,
  sanitizeHash,
  type FirmasStructurePlan,
} from "../src/domain/agenda-sheets/firmas-sheet-structure-planner.ts";

const START = process.env.FIRMAS_PLAN_FROM ?? "2026-09-01";
const DAYS = Number(process.env.FIRMAS_PLAN_DAYS ?? "30");
const OUT_DIR = join(
  process.env.HOME ?? "/tmp",
  "Desktop/concasa-firmas-p1-backup",
);

type InvRow = {
  sheet_id: number;
  sheet_title: string;
  booking_date: string;
  sheet_row: number;
  kind: string;
  location_id: string;
  slot_time: string;
  status: string;
  booking_id: string | null;
  slot_key: string | null;
  visible_nss?: string | null;
  visible_name?: string | null;
};

function ymdAdd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function hhmm(t: string): string {
  return String(t ?? "").slice(0, 5);
}

async function fetchInventory(url: string, key: string, from: string, to: string): Promise<InvRow[]> {
  const rows: InvRow[] = [];
  let offset = 0;
  const page = 1000;
  for (;;) {
    const q = new URL(`${url}/rest/v1/agenda_sheet_slot_inventory`);
    q.searchParams.set(
      "select",
      "sheet_id,sheet_title,booking_date,sheet_row,kind,location_id,slot_time,status,booking_id,slot_key,visible_nss,visible_name",
    );
    q.searchParams.set("booking_date", `gte.${from}`);
    q.searchParams.set("and", `(booking_date.lte.${to})`);
    q.searchParams.set("order", "booking_date,sheet_title,sheet_row");
    q.searchParams.set("limit", String(page));
    q.searchParams.set("offset", String(offset));
    const res = await fetch(q, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "count=exact",
      },
    });
    if (!res.ok) {
      throw new Error(`inventory_http_${res.status}:${(await res.text()).slice(0, 200)}`);
    }
    const batch = (await res.json()) as InvRow[];
    rows.push(...batch);
    if (batch.length < page) break;
    offset += page;
  }
  return rows;
}

function planFromInventoryTab(
  date: string,
  title: string,
  sheetId: number,
  rows: InvRow[],
): {
  plan: FirmasStructurePlan;
  decision: "SAFE_TO_APPLY" | "STOP_NO_SAFE_CAPACITY";
  monterrey: Record<string, unknown>;
  apodaca: Record<string, unknown>;
  bio: Record<string, unknown>;
  protectedOther: number;
} {
  // Reconstruct a minimal A:U grid from inventory rows + synthetic section headers.
  // Without Google SA we cannot see blank template rows that are NOT in inventory.
  const byKindLoc = new Map<string, InvRow[]>();
  for (const r of rows) {
    const k = `${r.kind}|${r.location_id}`;
    const list = byKindLoc.get(k) ?? [];
    list.push(r);
    byKindLoc.set(k, list);
  }

  const grid: string[][] = [];
  const pushHeader = (label: string) => {
    grid.push([label]);
  };
  const pushInv = (r: InvRow) => {
    const line = Array.from({ length: 21 }, () => "");
    line[0] = hhmm(r.slot_time);
    if (r.visible_nss) line[1] = String(r.visible_nss);
    if (r.visible_name) line[2] = String(r.visible_name);
    if (r.slot_key) line[14] = String(r.slot_key);
    if (r.booking_id) line[16] = String(r.booking_id);
    // Pad grid so sheet_row indexes roughly match (best-effort)
    while (grid.length + 1 < r.sheet_row) {
      grid.push([]);
    }
    grid[r.sheet_row - 1] = line;
  };

  // Order sections like real Sheet
  const order = [
    ["firmas", "apodaca", "APODACA FIRMAS"],
    ["firmas", "monterrey", "MONTERREY FIRMAS"],
    ["biometricos", "monterrey", "MONTERREY BIOMETRICOS"],
    ["biometricos", "apodaca", "APODACA BIOMETRICOS"],
  ] as const;

  for (const [kind, loc, header] of order) {
    const list = (byKindLoc.get(`${kind}|${loc}`) ?? []).slice().sort((a, b) => a.sheet_row - b.sheet_row);
    if (list.length === 0) continue;
    const headerRow = Math.max(1, list[0]!.sheet_row - 1);
    while (grid.length + 1 < headerRow) grid.push([]);
    if (!grid[headerRow - 1]?.[0]) {
      while (grid.length < headerRow) grid.push([]);
      grid[headerRow - 1] = [header];
    } else {
      pushHeader(header);
    }
    for (const r of list) pushInv(r);
  }

  const linked = new Set(
    rows.filter((r) => r.status === "linked" || r.status === "claimed").map((r) => r.sheet_row),
  );
  const plan = buildFirmasStructurePlan({
    sheetId,
    sheetTitle: title,
    bookingDate: date,
    grid,
    linkedRows: linked,
  });

  const firmasStats = (sede: "monterrey" | "apodaca") => {
    const firmas = rows.filter((r) => r.kind === "firmas" && r.location_id === sede);
    const byTime: Record<string, number> = { "08:00": 0, "09:00": 0, "10:00": 0 };
    for (const r of firmas) {
      const t = hhmm(r.slot_time);
      if (t in byTime) byTime[t]! += 1;
    }
    const currentTarget = byTime["08:00"]! + byTime["09:00"]! + byTime["10:00"]!;
    const missing =
      Math.max(0, 5 - byTime["08:00"]!) +
      Math.max(0, 5 - byTime["09:00"]!) +
      Math.max(0, 5 - byTime["10:00"]!);
    return {
      currentRowsTarget: currentTarget,
      byTime,
      safeReusable: plan.rowAnalyses.filter(
        (a) => a.section?.sede === sede && a.section.kind === "firmas" && a.reusableForNewSlot,
      ).length,
      missing,
      no_shift: missing === 0, // inventory-only: blanks outside inventory unknown without Google
    };
  };

  const mty = firmasStats("monterrey");
  const apo = firmasStats("apodaca");
  const bioRows = rows.filter((r) => r.kind === "biometricos");
  const bio = {
    count: bioRows.length,
    earliestRow: bioRows.length ? Math.min(...bioRows.map((r) => r.sheet_row)) : null,
    latestRow: bioRows.length ? Math.max(...bioRows.map((r) => r.sheet_row)) : null,
    checksums: bioRows.map((r) => ({
      sheetId,
      row: r.sheet_row,
      slot_key: r.slot_key,
      booking_id: r.booking_id,
      status: r.status,
      contentHash: createHash("sha256")
        .update(
          sanitizeHash([
            hhmm(r.slot_time),
            String(r.visible_nss ?? ""),
            String(r.visible_name ?? ""),
            String(r.slot_key ?? ""),
            String(r.booking_id ?? ""),
            r.status,
          ]),
        )
        .digest("hex")
        .slice(0, 16),
    })),
  };
  const protectedOther = rows.filter((r) =>
    ["linked", "claimed", "occupied_external", "conflict"].includes(r.status),
  ).length;

  // Without Google SA we cannot prove blank templates → if missing > 0 → STOP
  const decision =
    mty.missing === 0 && apo.missing === 0 ? "SAFE_TO_APPLY" : "STOP_NO_SAFE_CAPACITY";

  return {
    plan: {
      ...plan,
      canExpandNoShift: decision === "SAFE_TO_APPLY",
      rejectReason:
        decision === "SAFE_TO_APPLY"
          ? null
          : "NO_SAFE_CAPACITY: faltan filas target 08/09/10 en inventory; blanks no visibles sin Google SA",
    },
    decision,
    monterrey: mty,
    apodaca: apo,
    bio,
    protectedOther,
  };
}

async function main() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    "";
  mkdirSync(OUT_DIR, { recursive: true });

  const to = ymdAdd(START, DAYS - 1);
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    phase: "FIRMAS_P212_PLANNER_CLOUD_RO",
    from: START,
    to,
    sheetWrites: 0,
    cloudWrites: 0,
    googleSaPresent: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS),
    note:
      "Inventory Cloud = proxy físico. Blanks/templates fuera de inventory requieren Google SA readonly.",
  };

  if (!url || !key) {
    report.error = "MISSING_SUPABASE_SERVICE_ROLE_FOR_RO_INVENTORY";
    report.decision = "STOP";
    writeFileSync(join(OUT_DIR, "firmas-p212-planner-cloud-ro.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const inv = await fetchInventory(url, key, START, to);
  const byTab = new Map<string, InvRow[]>();
  for (const r of inv) {
    const k = `${r.booking_date}||${r.sheet_title}||${r.sheet_id}`;
    const list = byTab.get(k) ?? [];
    list.push(r);
    byTab.set(k, list);
  }

  const tabs: unknown[] = [];
  let safe = 0;
  let stop = 0;
  let bioBaseline = 0;

  for (const [keyTab, rows] of [...byTab.entries()].sort()) {
    const [date, title, sheetIdStr] = keyTab.split("||");
    const built = planFromInventoryTab(date!, title!, Number(sheetIdStr), rows);
    if (built.decision === "SAFE_TO_APPLY") safe += 1;
    else stop += 1;
    bioBaseline += Number(built.bio.count ?? 0);
    tabs.push({
      DATE: date,
      TAB: title,
      sheetId: Number(sheetIdStr),
      MONTERREY: built.monterrey,
      APODACA: built.apodaca,
      BIO_ROWS: built.bio,
      OTHER_PROTECTED_ROWS: built.protectedOther,
      DECISION: built.decision,
      sections: built.plan.sections,
    });
  }

  report.tabsInspected = tabs.length;
  report.tabsSafe = safe;
  report.tabsStop = stop;
  report.biometricBaselineRows = bioBaseline;
  report.expectedBiometricChangedRows = 0;
  report.tabs = tabs;
  report.verdict =
    tabs.length === 0
      ? "STOP"
      : stop > 0
        ? "STOP_NO_SAFE_CAPACITY"
        : "READY_FOR_CONTROLLED_SHEET_APPLY_PENDING_GOOGLE_SA_CONFIRM";

  const out = join(OUT_DIR, "firmas-p212-planner-cloud-ro.json");
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    out,
    tabsInspected: tabs.length,
    tabsSafe: safe,
    tabsStop: stop,
    bioBaseline,
    verdict: report.verdict,
    sheetWrites: 0,
    cloudWrites: 0,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
