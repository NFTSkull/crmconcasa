import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addCalendarDaysYmd,
  availabilityHorizonBounds,
  decideLiveSyncScope,
  GOOGLE_READ_STRATEGY,
  horizonHttpStatus,
  horizonPublicBody,
  runAvailabilityHorizon,
  selectHorizonTabs,
  ymdInTimeZone,
} from "./availability-horizon.ts";
import type { InventoryUpsertRow } from "./inventory-from-grid.ts";

const ORG = "00000000-0000-4000-8188-000000000001";
const SHEET = "spreadsheet-test";
const NOW = new Date("2026-08-15T18:00:00.000Z");

function emptyFirmasGrid(): string[][] {
  return [["MONTERREY FIRMAS"], ["8:30 AM", "", "", ""]];
}

function fullPhysicalFirmasGrid(): string[][] {
  return [
    ["MONTERREY FIRMAS"],
    ["8:30 AM", "12345678901", "Cliente", "Asesor"],
    ["8:30 AM", "12345678902", "Cliente", "Asesor"],
    ["8:30 AM", "12345678903", "Cliente", "Asesor"],
  ];
}

function a1(title: string): string {
  return `'${title.replace(/'/g, "''")}'!A1:U200`;
}

describe("P188 live-sync scope=horizon helpers", () => {
  it("GOOGLE_READ_STRATEGY = BATCH_GET", () => {
    assert.equal(GOOGLE_READ_STRATEGY, "BATCH_GET");
  });

  it("scope ausente → single_date (JWT o worker)", () => {
    assert.equal(
      decideLiveSyncScope({
        scope: undefined,
        workerOk: false,
        userOk: true,
        mode: "availability",
      }).kind,
      "single_date",
    );
    assert.equal(
      decideLiveSyncScope({
        scope: undefined,
        workerOk: true,
        userOk: false,
        mode: "book_gate",
      }).kind,
      "single_date",
    );
  });

  it("horizon + JWT asesor/super_admin → 403", () => {
    const d = decideLiveSyncScope({
      scope: "horizon",
      workerOk: false,
      userOk: true,
      mode: "availability",
    });
    assert.equal(d.kind, "reject");
    if (d.kind === "reject") {
      assert.equal(d.status, 403);
      assert.equal(d.code, "horizon_forbidden");
    }
  });

  it("horizon sin auth → 401", () => {
    const d = decideLiveSyncScope({
      scope: "horizon",
      workerOk: false,
      userOk: false,
      mode: "availability",
    });
    assert.equal(d.kind, "reject");
    if (d.kind === "reject") {
      assert.equal(d.status, 401);
    }
  });

  it("horizon + worker + availability → allowed", () => {
    assert.equal(
      decideLiveSyncScope({
        scope: "horizon",
        workerOk: true,
        userOk: false,
        mode: "availability",
      }).kind,
      "horizon",
    );
  });

  it("horizon + worker + book_gate → reject", () => {
    const d = decideLiveSyncScope({
      scope: "horizon",
      workerOk: true,
      userOk: false,
      mode: "book_gate",
    });
    assert.equal(d.kind, "reject");
    if (d.kind === "reject") {
      assert.equal(d.status, 400);
      assert.equal(d.code, "horizon_mode_invalid");
    }
  });

  it("horizonte TZ America/Monterrey: yesterday skip, today/+60 include, +61 skip, inválida skip", () => {
    const { from, to } = availabilityHorizonBounds(NOW);
    assert.equal(from, ymdInTimeZone(NOW, "America/Monterrey"));
    assert.equal(to, addCalendarDaysYmd(from, 60));
    const plus61 = addCalendarDaysYmd(from, 61);
    const yesterday = addCalendarDaysYmd(from, -1);
    const tabs = selectHorizonTabs({
      year: 2026,
      from,
      to,
      tabs: [
        { sheetId: 1, title: "14 AGOSTO", hidden: false },
        { sheetId: 2, title: "15 AGOSTO", hidden: false },
        { sheetId: 3, title: "14 OCTUBRE", hidden: false },
        { sheetId: 4, title: "15 OCTUBRE", hidden: false },
        { sheetId: 5, title: "NO DATE", hidden: false },
        { sheetId: 6, title: "FORMATO", hidden: false },
        { sheetId: 7, title: "15 AGOSTO", hidden: true },
      ],
    });
    const dates = tabs.map((t) => t.bookingDate).sort();
    assert.equal(dates.includes(yesterday), false);
    assert.ok(dates.includes(from), `today ${from} in ${dates.join(",")}`);
    assert.ok(dates.includes(to), `+60 ${to} in ${dates.join(",")}`);
    assert.equal(dates.includes(plus61), false);
    assert.equal(
      tabs.some((t) => t.title === "NO DATE" || t.title === "FORMATO"),
      false,
    );
    assert.equal(
      tabs.some((t) => t.hidden),
      false,
    );
  });
});

describe("P188 horizon isolation / FULL_PHYSICAL / reads", () => {
  it("tab mala en medio no aborta; no declara fresh en B", async () => {
    const { from, to } = availabilityHorizonBounds(NOW);
    const tabA = "15 AGOSTO";
    const tabB = "17 AGOSTO";
    const tabC = "20 AGOSTO";
    const store = new Map<string, string[][]>([
      [a1(tabA), emptyFirmasGrid()],
      [a1(tabB), emptyFirmasGrid()],
      [a1(tabC), emptyFirmasGrid()],
    ]);
    let batchGets = 0;
    const upsertedDates: string[] = [];
    const result = await runAvailabilityHorizon({
      tabs: [
        { sheetId: 1, title: tabA, hidden: false },
        { sheetId: 2, title: tabB, hidden: false },
        { sheetId: 3, title: tabC, hidden: false },
      ],
      from,
      to,
      year: 2026,
      organizationId: ORG,
      spreadsheetId: SHEET,
      timeAliases: [],
      batchGetValues: async (ranges) => {
        batchGets += 1;
        const out = new Map<string, string[][]>();
        for (const r of ranges) out.set(r, store.get(r) ?? []);
        return out;
      },
      upsertBatch: async (rows: InventoryUpsertRow[]) => {
        const d = rows[0]?.booking_date;
        if (d === "2026-08-17") {
          return {
            error: {
              message:
                "agenda_sheet_inventory_upsert_batch: booking_id b2b3d5a9-bb34-4ca3-9e9a-454a9d01fc14 aparece en 2 filas físicas del mismo batch",
            },
          };
        }
        upsertedDates.push(String(d));
        return { error: null };
      },
    });
    assert.equal(batchGets, 1);
    assert.equal(result.get_values, 0);
    assert.equal(result.list_sheets, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.succeeded, 2);
    assert.equal(result.outcome, "partial_success");
    assert.equal(horizonHttpStatus(result), 207);
    assert.deepEqual(
      result.failures.map((f) => f.date),
      ["2026-08-17"],
    );
    assert.equal(result.failures[0]?.code, "upsert_failed");
    assert.ok(upsertedDates.includes("2026-08-15"));
    assert.ok(upsertedDates.includes("2026-08-20"));
    assert.ok(!upsertedDates.includes("2026-08-17"));
    assert.ok(!result.succeeded_tabs.some((t) => t.date === "2026-08-17"));
    const publicBody = horizonPublicBody(result);
    assert.equal(JSON.stringify(publicBody).includes("12345678901"), false);
    assert.equal(JSON.stringify(publicBody).includes("b2b3d5a9"), false);
    assert.equal(publicBody.partial, true);
  });

  it("FULL_PHYSICAL: upserta available=0, no fabrica cupos", async () => {
    const { from, to } = availabilityHorizonBounds(NOW);
    const title = "15 AGOSTO";
    const result = await runAvailabilityHorizon({
      tabs: [{ sheetId: 9, title, hidden: false }],
      from,
      to,
      year: 2026,
      organizationId: ORG,
      spreadsheetId: SHEET,
      timeAliases: [],
      batchGetValues: async () =>
        new Map([[a1(title), fullPhysicalFirmasGrid()]]),
      upsertBatch: async (rows) => {
        assert.ok(rows.length > 0);
        assert.equal(
          rows.every((r) => r.status !== "available"),
          true,
        );
        return { error: null };
      },
    });
    assert.equal(result.succeeded, 1);
    assert.equal(result.succeeded_tabs[0]?.available, 0);
    assert.ok((result.succeeded_tabs[0]?.upserted ?? 0) > 0);
  });

  it("horizon no invoca writes Google ni RPCs operativos", async () => {
    const { from, to } = availabilityHorizonBounds(NOW);
    const writes: string[] = [];
    const rpcs: string[] = [];
    await runAvailabilityHorizon({
      tabs: [{ sheetId: 1, title: "15 AGOSTO", hidden: false }],
      from,
      to,
      year: 2026,
      organizationId: ORG,
      spreadsheetId: SHEET,
      timeAliases: [],
      batchGetValues: async (ranges) => {
        assert.ok(ranges.length >= 1);
        return new Map([[ranges[0]!, emptyFirmasGrid()]]);
      },
      upsertBatch: async () => {
        rpcs.push("agenda_sheet_inventory_upsert_batch");
        return { error: null };
      },
    });
    assert.deepEqual(writes, []);
    assert.deepEqual(rpcs, ["agenda_sheet_inventory_upsert_batch"]);
    assert.equal(
      rpcs.some((n) => /book_|cancel_|reagendar|apply_operational|inscripcion_require|action_log/i.test(n)),
      false,
    );
  });
});

describe("P188 live-sync / migration source contracts", () => {
  const live = readFileSync(
    join(process.cwd(), "supabase/functions/agenda-sheet-live-sync/index.ts"),
    "utf8",
  );
  const google = readFileSync(
    join(
      process.cwd(),
      "supabase/functions/_shared/agenda-sheets/google.ts",
    ),
    "utf8",
  );
  const mig182 = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/182_agenda_sheet_availability_refresh_cron.sql",
    ),
    "utf8",
  );
  const mig132 = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/132_agenda_sheet_reconcile_cron.sql",
    ),
    "utf8",
  );
  const mig130 = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/130_agenda_sheet_sync_worker_cron.sql",
    ),
    "utf8",
  );

  it("single-date contract: bookingDate, JWT roles, book_gate, upsert abort 500", () => {
    assert.match(live, /kind\?: "biometricos" \| "firmas" \| "inscripcion"/);
    assert.match(live, /select\("app_role,active"\)/);
    assert.match(live, /book_gate/);
    assert.match(live, /decideBookHardGate/);
    assert.match(live, /liveSyncJsonError\(\s*500,\s*"upsert_failed"/);
    assert.match(live, /adapter\.getValues/);
  });

  it("horizon: worker-only, batchGet, continue on tab fail, no P170", () => {
    assert.match(live, /scope\?: string/);
    assert.match(live, /decideLiveSyncScope/);
    assert.match(live, /runAvailabilityHorizon/);
    assert.match(live, /adapter\.batchGetValues/);
    assert.doesNotMatch(live, /applyOperationalResult/);
    assert.doesNotMatch(live, /agenda_inscripcion_require/);
    assert.doesNotMatch(live, /from\("action_log"\)/);
  });

  it("google adapter batchGet es READ (values.batchGet)", () => {
    assert.match(google, /values:batchGet/);
    assert.match(google, /batchGetValues/);
  });

  it("migration 182 cron/payload/grants; no toca 130/132", () => {
    assert.match(mig182, /agenda-sheet-availability-refresh-every-2h/);
    assert.match(mig182, /7 \*\/2 \* \* \*/);
    assert.match(mig182, /agenda_sheet_invoke_availability_refresh/);
    assert.match(mig182, /functions\/v1\/agenda-sheet-live-sync/);
    assert.match(mig182, /'mode', 'availability'/);
    assert.match(mig182, /'scope', 'horizon'/);
    assert.match(mig182, /timeout_milliseconds := 55000/);
    assert.match(mig182, /agenda_sheet_project_url/);
    assert.match(mig182, /agenda_sheet_worker_secret/);
    assert.match(
      mig182,
      /REVOKE ALL ON FUNCTION public\.agenda_sheet_invoke_availability_refresh\(\) FROM PUBLIC, anon, authenticated/,
    );
    assert.match(
      mig182,
      /GRANT EXECUTE ON FUNCTION public\.agenda_sheet_invoke_availability_refresh\(\) TO postgres/,
    );
    assert.doesNotMatch(mig182, /BEGIN PRIVATE KEY/);
    assert.doesNotMatch(mig182, /eyJ[A-Za-z0-9_-]{10,}/);
    assert.doesNotMatch(mig182, /agenda-sheet-reconcile-every-15m/);
    assert.doesNotMatch(mig182, /agenda_sheet_invoke_reconcile/);
    assert.doesNotMatch(mig182, /agenda-sheet-sync-worker-every-minute/);
    assert.doesNotMatch(mig182, /agenda_sheet_invoke_sync_worker/);
    assert.match(mig132, /agenda-sheet-reconcile-every-15m/);
    assert.match(mig130, /agenda-sheet-sync-worker-every-minute/);
  });
});
