/**
 * Edge AISLADA: agenda-sheet-firmas-provisioner (Fase 2A)
 * Append-only físico Firmas — UNA tab por invoke.
 *
 * Modes: dry_run (default) | apply (confirm=true + bookingDate única).
 * NO toca live-sync / worker / reconcile / webhook / SQL.
 *
 * Auth: x-concasa-worker-secret. Nunca loguea secrets/tokens/PEM.
 */
import {
  DEFAULT_SPREADSHEET_ID,
  jsonError,
  jsonOk,
  parseSection,
  parseTabDate,
  parseTime,
  timingSafeEqual,
} from "../_shared/agenda-sheets/parsers.ts";
import { createFirmasProvisionerSheetsAdapter } from "../_shared/agenda-sheets/google-firmas-provisioner.ts";
import {
  buildFirmasProvisionerPlan,
  buildProvisionerBatchRequests,
  lastUsedRowFromGrid,
  type FirmasProvisionerHour,
} from "../_shared/agenda-sheets/firmas-provisioner-plan.ts";
import { buildInventoryUpsertRows } from "../_shared/agenda-sheets/inventory-from-grid.ts";
import {
  isPlausibleFirmasApodacaTime,
  resolveOrphanSection,
  type SheetSectionRef,
} from "../_shared/agenda-sheets/section-recovery.ts";

function quoteSheetTitle(title: string): string {
  return `'${String(title).replace(/'/g, "''")}'`;
}

function yearHint(): number {
  const y = Number(Deno.env.get("AGENDA_SHEETS_YEAR") ?? "2026");
  return Number.isFinite(y) && y >= 2020 ? y : 2026;
}

function stableJson(x: unknown): string {
  if (x == null) return "null";
  if (typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(stableJson).join(",")}]`;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
}

function fingerprint(payload: unknown): string {
  const s = stableJson(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `f${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function countPhysical(
  rows: readonly { kind: string; location_id: string; sheet_slot_time: string }[],
  sede: string,
  hour: string,
): number {
  return rows.filter(
    (r) =>
      r.kind === "firmas" &&
      r.location_id === sede &&
      String(r.sheet_slot_time).slice(0, 5) === hour,
  ).length;
}

function pickFormatSources(input: {
  grid: string[][];
  headerMtyRow: number | null;
}): {
  headerFormatRow: number;
  mty08: number;
  mty09: number;
  mty10: number;
  apo: number;
} | null {
  type Cand = { row: number; time: string; blank: boolean; sedeHint: "mty" | "apo" | "unk" };
  const cands: Cand[] = [];
  let section: SheetSectionRef | null = null;
  const orphans: { row: number; time: string; blank: boolean }[] = [];

  for (let i = 0; i < input.grid.length; i++) {
    const rowNum = i + 1;
    const a = String(input.grid[i]?.[0] ?? "").trim();
    const sec = parseSection(a);
    if (sec) {
      if (orphans.length > 0) {
        const resolved = resolveOrphanSection({
          orphanTimes: orphans.map((o) => o.time),
          orphanSheetRows: orphans.map((o) => o.row),
          nextSection:
            sec.sede === "monterrey" || sec.sede === "apodaca"
              ? { sede: sec.sede, kind: sec.kind as SheetSectionRef["kind"] }
              : null,
          prevSection: section,
        });
        if (resolved?.sede === "apodaca" && resolved.kind === "firmas") {
          for (const o of orphans) {
            cands.push({ ...o, sedeHint: "apo" });
          }
        }
        orphans.length = 0;
      }
      if (
        (sec.kind === "firmas" || sec.kind === "biometricos") &&
        (sec.sede === "monterrey" || sec.sede === "apodaca")
      ) {
        section = { sede: sec.sede, kind: sec.kind as SheetSectionRef["kind"] };
      } else {
        section = null;
      }
      continue;
    }
    const t = parseTime(a);
    if (!t) continue;
    const blank = (input.grid[i] ?? [])
      .slice(1, 21)
      .every((c) => String(c ?? "").trim() === "");
    if (section?.kind === "firmas" && section.sede === "monterrey") {
      cands.push({ row: rowNum, time: t, blank, sedeHint: "mty" });
    } else if (section?.kind === "firmas" && section.sede === "apodaca") {
      cands.push({ row: rowNum, time: t, blank, sedeHint: "apo" });
    } else if (!section && isPlausibleFirmasApodacaTime(t)) {
      orphans.push({ row: rowNum, time: t, blank });
    }
  }
  if (orphans.length > 0) {
    const resolved = resolveOrphanSection({
      orphanTimes: orphans.map((o) => o.time),
      orphanSheetRows: orphans.map((o) => o.row),
      nextSection: null,
      prevSection: section,
    });
    if (resolved?.sede === "apodaca" && resolved.kind === "firmas") {
      for (const o of orphans) cands.push({ ...o, sedeHint: "apo" });
    }
  }

  const pick = (
    sede: "mty" | "apo",
    preferredTimes: string[],
  ): number | null => {
    for (const t of preferredTimes) {
      const list = cands
        .filter((c) => c.sedeHint === sede && c.time === t)
        .sort((a, b) => Number(b.blank) - Number(a.blank));
      if (list[0]) return list[0].row;
    }
    const any = cands
      .filter((c) => c.sedeHint === sede)
      .sort((a, b) => Number(b.blank) - Number(a.blank));
    return any[0]?.row ?? null;
  };

  const headerFormatRow = input.headerMtyRow;
  const mty08 = pick("mty", ["08:30", "08:00"]);
  const mty09 = pick("mty", ["09:00", "09:30"]);
  const mty10 = pick("mty", ["10:00", "10:30"]);
  const apo = pick("apo", ["10:30", "10:00", "08:00"]);
  if (!headerFormatRow || !mty08 || !mty09 || !mty10 || !apo) return null;
  return { headerFormatRow, mty08, mty09, mty10, apo };
}

function findHeaderMtyRow(grid: string[][]): number | null {
  for (let i = 0; i < grid.length; i++) {
    const sec = parseSection(String(grid[i]?.[0] ?? ""));
    if (sec?.sede === "monterrey" && sec.kind === "firmas") return i + 1;
  }
  return null;
}

function buildPreSnapshot(input: {
  grid: string[][];
  lastUsedRowPre: number;
  structure: unknown;
  inventoryRows: ReturnType<typeof buildInventoryUpsertRows>["rows"];
}): Record<string, unknown> {
  const rowHashes: Array<Record<string, unknown>> = [];
  for (let r = 1; r <= input.lastUsedRowPre; r++) {
    const vals = (input.grid[r - 1] ?? []).slice(0, 21).map((c) => String(c ?? ""));
    rowHashes.push({
      row: r,
      valuesHash: fingerprint(vals),
      a: vals[0] ?? "",
    });
  }
  const bio = input.inventoryRows
    .filter((r) => r.kind === "biometricos")
    .map((r) => ({
      sheet_row: r.sheet_row,
      slot_key: r.slot_key,
      status: r.status,
      sheet_slot_time: r.sheet_slot_time,
      location_id: r.location_id,
    }));
  const firmasInv = input.inventoryRows
    .filter((r) => r.kind === "firmas")
    .map((r) => ({
      sheet_row: r.sheet_row,
      slot_key: r.slot_key,
      status: r.status,
      sheet_slot_time: r.sheet_slot_time,
      location_id: r.location_id,
    }));
  return {
    lastUsedRowPre: input.lastUsedRowPre,
    preexistingRowCount: input.lastUsedRowPre,
    preexistingValuesFingerprint: fingerprint(rowHashes),
    preexistingRows: rowHashes,
    biometricos: bio,
    biometricosFingerprint: fingerprint(bio),
    firmasInventoryRefs: firmasInv,
    firmasInventoryFingerprint: fingerprint(firmasInv),
    structureFingerprint: fingerprint({
      // merges + row heights from structure (redacted-ish)
      raw: typeof input.structure === "object" ? "present" : "absent",
    }),
  };
}

function assertDestinationRowsBlank(
  grid: string[][],
  fromRow: number,
  toRow: number,
): void {
  for (let r = fromRow; r <= toRow; r++) {
    const row = grid[r - 1] ?? [];
    const occupied = row.slice(0, 21).some((c) => String(c ?? "").trim() !== "");
    if (occupied) {
      throw new Error(`destination_row_not_blank:${r}`);
    }
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonError(405, "method_not_allowed", "Solo POST");
    }

    const secret =
      (Deno.env.get("GOOGLE_SHEETS_WORKER_SECRET") ?? "").trim() ||
      (Deno.env.get("GOOGLE_SHEETS_WEBHOOK_SECRET") ?? "").trim();
    const hdr =
      req.headers.get("x-concasa-worker-secret") ??
      req.headers.get("x-concasa-webhook-secret") ??
      "";
    if (!secret || !timingSafeEqual(hdr, secret)) {
      return jsonError(401, "unauthorized", "Secreto inválido");
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const mode = body.mode === "apply" ? "apply" : "dry_run";
    const confirm = body.confirm === true;
    const bookingDate = String(body.bookingDate ?? "").slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
      return jsonError(400, "invalid_booking_date", "bookingDate YYYY-MM-DD requerido");
    }
    if (Array.isArray(body.dates) || Array.isArray(body.tabs) || body.from || body.to) {
      return jsonError(
        400,
        "range_not_allowed",
        "Fase 2A: solo una bookingDate; sin rangos/arrays",
      );
    }
    if (mode === "apply" && !confirm) {
      return jsonError(400, "confirm_required", "apply requiere confirm=true");
    }

    const email = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "").trim();
    const pk = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "").trim();
    const spreadsheetId =
      (Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? "").trim() ||
      DEFAULT_SPREADSHEET_ID;
    if (!email || !pk) {
      return jsonError(500, "missing_google_creds", "Credenciales no configuradas");
    }

    const adapter = await createFirmasProvisionerSheetsAdapter({
      spreadsheetId,
      serviceAccountEmail: email,
      privateKeyPem: pk,
    });

    const sheets = await adapter.listSheets();
    const y = yearHint();
    const tab = sheets
      .filter((s) => !s.hidden)
      .map((s) => ({ ...s, bookingDate: parseTabDate(s.title, y) }))
      .find((s) => s.bookingDate === bookingDate);

    if (!tab) {
      return jsonError(404, "tab_not_found", `Sin pestaña para ${bookingDate}`);
    }

    const range = `${quoteSheetTitle(tab.title)}!A1:U200`;
    const grid = await adapter.getValues(range);
    // Normalizar a 200 filas lógicas para lastUsed
    const padded = [...grid];
    while (padded.length < 200) padded.push([]);

    const lastUsedRowPre = lastUsedRowFromGrid(padded);
    const structure = await adapter.getSpreadsheetStructure({
      rangesA1: [range],
      includeGridData: true,
    });

    const orgId = (Deno.env.get("AGENDA_SHEETS_ORG_ID") ?? "00000000-0000-0000-0000-000000000000").trim();
    const parsed = buildInventoryUpsertRows({
      organizationId: orgId,
      spreadsheetId,
      sheetId: tab.sheetId,
      sheetTitle: tab.title,
      bookingDate,
      grid: padded,
    });

    const hours = ["08:00", "09:00", "10:00"] as const;
    const mtyPhysical: Partial<Record<FirmasProvisionerHour, number>> = {};
    const apoPhysical: Partial<Record<FirmasProvisionerHour, number>> = {};
    for (const h of hours) {
      mtyPhysical[h] = countPhysical(parsed.rows, "monterrey", h);
      apoPhysical[h] = countPhysical(parsed.rows, "apodaca", h);
    }

    const headerMtyRow = findHeaderMtyRow(padded);
    const sources = pickFormatSources({ grid: padded, headerMtyRow });
    if (!sources) {
      return jsonOk({
        function: "agenda-sheet-firmas-provisioner",
        version: 1,
        mode,
        decision: "STOP",
        rejectReason: "STOP_FORMAT_SOURCES_MISSING",
        bookingDate,
        sheetId: tab.sheetId,
        sheetTitle: tab.title,
        sheetWrites: 0,
        cloudDbWrites: 0,
        bookings: 0,
      });
    }

    const plan = buildFirmasProvisionerPlan({
      bookingDate,
      sheetId: tab.sheetId,
      sheetTitle: tab.title,
      lastUsedRowPre,
      gridRowCount: tab.rowCount,
      mtyPhysical,
      apoPhysical,
      sources,
    });

    const preSnapshot = buildPreSnapshot({
      grid: padded,
      lastUsedRowPre,
      structure,
      inventoryRows: parsed.rows,
    });
    const planHash = fingerprint({
      layout: plan.layout,
      sources: plan.sources,
      monterrey: plan.monterrey,
      apodaca: plan.apodaca,
      lastUsedRowPre,
    });

    if (plan.decision !== "SAFE_CANONICAL_APPEND") {
      return jsonOk({
        function: "agenda-sheet-firmas-provisioner",
        version: 1,
        mode,
        decision: plan.decision,
        rejectReason: plan.rejectReason,
        bookingDate,
        sheetId: tab.sheetId,
        sheetTitle: tab.title,
        plan,
        preSnapshot,
        planHash,
        sheetWrites: 0,
        cloudDbWrites: 0,
        bookings: 0,
      });
    }

    const requests =
      plan.layout.length === 0 ? [] : buildProvisionerBatchRequests(plan);

    if (mode === "dry_run") {
      return jsonOk({
        function: "agenda-sheet-firmas-provisioner",
        version: 1,
        mode: "dry_run",
        decision: "SAFE_CANONICAL_APPEND",
        bookingDate,
        sheetId: tab.sheetId,
        sheetTitle: tab.title,
        lastUsedRowPre,
        firstNewRow: plan.firstNewRow,
        lastNewRow: plan.lastNewRow,
        plan,
        requestsCount: requests.length,
        // No devolver requests completos con riesgo; solo tipos
        requestKinds: requests.map((r) => Object.keys(r)[0]),
        preSnapshot,
        planHash,
        sheetWrites: 0,
        cloudDbWrites: 0,
        bookings: 0,
      });
    }

    // ——— APPLY ———
    if (plan.layout.length > 0) {
      assertDestinationRowsBlank(padded, plan.firstNewRow, plan.lastNewRow);
      await adapter.applyAllowlistedBatchUpdate(requests, {
        sheetId: tab.sheetId,
        lastUsedRowPre,
      });
    }

    // Readback inmediato
    const postGrid = await adapter.getValues(range);
    const postPadded = [...postGrid];
    while (postPadded.length < 200) postPadded.push([]);
    const postParsed = buildInventoryUpsertRows({
      organizationId: orgId,
      spreadsheetId,
      sheetId: tab.sheetId,
      sheetTitle: tab.title,
      bookingDate,
      grid: postPadded,
    });
    const postSnapshot = buildPreSnapshot({
      grid: postPadded,
      lastUsedRowPre,
      structure: null,
      inventoryRows: postParsed.rows,
    });

    // Compare preexisting values (rows 1..lastUsedRowPre)
    let preexistingChanged = 0;
    for (let r = 1; r <= lastUsedRowPre; r++) {
      const pre = (padded[r - 1] ?? []).slice(0, 21).map((c) => String(c ?? ""));
      const post = (postPadded[r - 1] ?? []).slice(0, 21).map((c) => String(c ?? ""));
      if (fingerprint(pre) !== fingerprint(post)) preexistingChanged += 1;
    }

    const preBio = preSnapshot.biometricos as unknown[];
    const postBio = postSnapshot.biometricos as unknown[];
    const bioChanged =
      fingerprint(preBio) === fingerprint(postBio) ? 0 : 1;

    // New rows B:U blank
    let newBuBlank = true;
    for (const item of plan.layout) {
      if (item.kind !== "slot") continue;
      const row = postPadded[item.row - 1] ?? [];
      const bu = row.slice(1, 21).some((c) => String(c ?? "").trim() !== "");
      if (bu) newBuBlank = false;
    }

    const phys = {
      mty08: countPhysical(postParsed.rows, "monterrey", "08:00"),
      mty09: countPhysical(postParsed.rows, "monterrey", "09:00"),
      mty10: countPhysical(postParsed.rows, "monterrey", "10:00"),
      apo08: countPhysical(postParsed.rows, "apodaca", "08:00"),
      apo09: countPhysical(postParsed.rows, "apodaca", "09:00"),
      apo10: countPhysical(postParsed.rows, "apodaca", "10:00"),
    };
    const keys = postParsed.rows.map((r) => r.slot_key);
    const slotDupes = keys.length - new Set(keys).size;

    const verified =
      preexistingChanged === 0 &&
      bioChanged === 0 &&
      newBuBlank &&
      phys.mty08 === 5 &&
      phys.mty09 === 5 &&
      phys.mty10 === 5 &&
      phys.apo08 === 5 &&
      phys.apo09 === 5 &&
      phys.apo10 === 5 &&
      slotDupes === 0 &&
      plan.lastNewRow <= 200;

    return jsonOk({
      function: "agenda-sheet-firmas-provisioner",
      version: 1,
      mode: "apply",
      decision: verified ? "PILOT_APPEND_VERIFIED" : "STOP",
      bookingDate,
      sheetId: tab.sheetId,
      sheetTitle: tab.title,
      lastUsedRowPre,
      firstNewRow: plan.firstNewRow,
      lastNewRow: plan.lastNewRow,
      plan,
      planHash,
      requestsCount: requests.length,
      requestKinds: requests.map((r) => Object.keys(r)[0]),
      sources: plan.sources,
      preSnapshot,
      postChecks: {
        preexistingChangedRows: preexistingChanged,
        biometricosChanged: bioChanged,
        newBuBlank,
        physical: phys,
        slotKeyDuplicates: slotDupes,
        lastNewRow: plan.lastNewRow,
      },
      sheetWrites: plan.layout.length === 0 ? 0 : 1,
      cloudDbWrites: 0,
      bookings: 0,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    const safe = msg
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted-pem]");
    return jsonError(500, "firmas_provisioner_failed", safe.slice(0, 280));
  }
});
