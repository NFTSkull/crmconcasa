/**
 * Edge Function: agenda-sheet-reconcile
 * Inventaría filas físicas del Sheet desde 2026-07-30 (read + upsert inventory).
 * No escribe nombres en Sheets.
 */
import {
  DEFAULT_SPREADSHEET_ID,
  jsonError,
  jsonOk,
  parseTabDate,
} from "../_shared/agenda-sheets/parsers.ts";
import { createGoogleSheetsAdapter } from "../_shared/agenda-sheets/google.ts";
import { buildInventoryUpsertRows } from "../_shared/agenda-sheets/inventory-from-grid.ts";
import { buildOperationalResultUpsertRows } from "../_shared/agenda-sheets/operational-results.ts";
import { applyOperationalResult } from "../_shared/agenda-sheets/apply-operational-result.ts";
import {
  evaluateOperationalApplyGate,
  getOperationalApplyConfig,
} from "../_shared/agenda-sheets/operational-apply-guard.ts";
import { COL_INDEX } from "../_shared/agenda-sheets/tech-columns.ts";
import type { AgendaSheetTimeAlias } from "../_shared/agenda-sheets/time-aliases.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const START = "2026-07-30";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonError(405, "method_not_allowed", "Solo POST");
    }
    if (Deno.env.get("GOOGLE_SHEETS_SYNC_ENABLED") === "false") {
      return jsonOk({ reconciled: 0, disabled: true });
    }
    const secret =
      (Deno.env.get("GOOGLE_SHEETS_WORKER_SECRET") ?? "").trim() ||
      (Deno.env.get("GOOGLE_SHEETS_WEBHOOK_SECRET") ?? "").trim();
    const hdr = req.headers.get("x-concasa-worker-secret") ??
      req.headers.get("x-concasa-webhook-secret") ?? "";
    const enc = new TextEncoder();
    const a = enc.encode(secret);
    const b = enc.encode(hdr);
    let ok = a.length === b.length && secret.length > 0;
    if (ok) {
      let x = 0;
      for (let i = 0; i < a.length; i++) x |= a[i]! ^ b[i]!;
      ok = x === 0;
    }
    if (!ok) return jsonError(401, "unauthorized", "Secreto inválido");

    const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
    const pk = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "";
    const spreadsheetId =
      Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? DEFAULT_SPREADSHEET_ID;
    const orgId = Deno.env.get("GOOGLE_SHEETS_ORGANIZATION_ID") ?? "";
    const year = Number(Deno.env.get("GOOGLE_SHEETS_YEAR") ?? "2026");
    if (!email || !pk || !orgId) {
      return jsonError(500, "missing_config", "Faltan credenciales/org");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const adapter = await createGoogleSheetsAdapter({
      spreadsheetId,
      serviceAccountEmail: email,
      privateKeyPem: pk,
    });

    let timeAliases: AgendaSheetTimeAlias[] = [];
    try {
      const { data: aliasJson } = await supabase.rpc(
        "agenda_sheet_list_time_aliases",
        { p_organization_id: orgId },
      );
      if (Array.isArray(aliasJson)) {
        timeAliases = aliasJson as AgendaSheetTimeAlias[];
      }
    } catch {
      timeAliases = [];
    }

    let body: { bookingDate?: string; kind?: string; locationId?: string } = {};
    try {
      const raw = await req.text();
      if (raw.trim()) body = JSON.parse(raw) as typeof body;
    } catch {
      body = {};
    }
    const filterDate = String(body.bookingDate ?? "").trim();
    const filterKind = String(body.kind ?? "").trim();
    const filterLocation = String(body.locationId ?? "").trim();

    const tabs = await adapter.listSheets();
    let upserted = 0;
    let ops_upserted = 0;
    let apply_count = 0;
    let apply_skipped = 0;
    let apply_errors = 0;
    let apply_before_cutover = 0;
    const apply_outcomes: Record<string, number> = {};
    const allIssues: unknown[] = [];

    const applyConfig = getOperationalApplyConfig();
    const applyGloballyAllowed = evaluateOperationalApplyGate({
      config: applyConfig,
      // sentinela: solo para detectar DISABLED / DISABLED_NO_CUTOVER
      bookingDate: applyConfig.fromDate ?? "9999-12-31",
    });
    // Si enabled + fromDate válida, applyGloballyAllowed.allow puede ser true;
    // el filtro por booking_date se aplica por tab/fila.
    const applyEngineOn =
      applyConfig.enabled && applyConfig.fromDate != null;

    for (const tab of tabs) {
      if (tab.hidden) continue;
      // No trim del título al armar A1: el Sheet puede tener trailing space ("30 JULIO ").
      const titleRaw = String(tab.title ?? "");
      const titleCmp = titleRaw.trim();
      if (/^FORMATO$/i.test(titleCmp)) continue;
      const date = parseTabDate(titleCmp, Number.isFinite(year) ? year : 2026);
      if (!date || date < START) continue;
      if (filterDate && date !== filterDate) continue;

      const titleEsc = `'${titleRaw.replace(/'/g, "''")}'`;
      const grid = await adapter.getValues(`${titleEsc}!A1:U200`);
      const backgroundsEi = await adapter.getEffectiveBackgrounds(
        `${titleEsc}!E1:I200`,
      );
      const { rows, issues } = buildInventoryUpsertRows({
        organizationId: orgId,
        spreadsheetId,
        sheetId: tab.sheetId,
        sheetTitle: titleRaw,
        bookingDate: date,
        grid,
        timeAliases,
      });
      for (const iss of issues) allIssues.push({ title: titleRaw, ...iss });
      const filtered = rows.filter((r) => {
        if (filterKind && r.kind !== filterKind) return false;
        if (filterLocation && r.location_id !== filterLocation) return false;
        return true;
      });
      if (filtered.length === 0) continue;

      // batches de 200
      for (let i = 0; i < filtered.length; i += 200) {
        const chunk = filtered.slice(i, i + 200);
        const { error } = await supabase.rpc("agenda_sheet_inventory_upsert_batch", {
          p_rows: chunk,
        });
        if (error) {
          return jsonError(
            500,
            "upsert_failed",
            `${error.message}`.slice(0, 240),
          );
        }
        upserted += chunk.length;
      }

      // Bernardo: proyección operativa (misma grilla; no altera cupo) → apply P170.
      const opsRows = buildOperationalResultUpsertRows({
        organizationId: orgId,
        spreadsheetId,
        sheetId: tab.sheetId,
        sheetTitle: titleRaw,
        bookingDate: date,
        grid,
        backgroundsEi,
      }).filter((r) => {
        if (filterKind && r.kind !== filterKind) return false;
        if (filterLocation && r.location_id !== filterLocation) return false;
        return true;
      });
      for (let i = 0; i < opsRows.length; i += 200) {
        const chunk = opsRows.slice(i, i + 200);
        if (chunk.length === 0) continue;
        const { error: opsErr } = await supabase.rpc(
          "agenda_sheet_ops_upsert_batch",
          { p_rows: chunk },
        );
        if (opsErr) {
          console.error(
            "agenda-sheet-reconcile ops upsert",
            String(opsErr.message ?? "").slice(0, 200),
          );
          // Sin proyección confiable no aplicamos el chunk; seguimos con el resto.
          continue;
        }
        ops_upserted += chunk.length;
        if (!applyEngineOn) {
          // Kill switch / fail-closed: P165 ok, cero applies RPC.
          continue;
        }
        for (const row of chunk) {
          const gate = evaluateOperationalApplyGate({
            config: applyConfig,
            bookingDate: row.booking_date,
          });
          if (!gate.allow) {
            if (gate.outcome === "BEFORE_CUTOVER") {
              apply_before_cutover += 1;
              apply_skipped += 1;
            } else {
              apply_skipped += 1;
            }
            continue;
          }
          try {
            const gridRow = grid[row.sheet_row - 1] ?? [];
            const applied = await applyOperationalResult(supabase, row, {
              visibleSheetTime: String(gridRow[COL_INDEX.hora] ?? ""),
              liveSlotKey: String(gridRow[COL_INDEX.slotKey] ?? ""),
            });
            apply_count += 1;
            if (applied.skippedRpc) apply_skipped += 1;
            const key = applied.outcome || "UNKNOWN";
            apply_outcomes[key] = (apply_outcomes[key] ?? 0) + 1;
            if (applied.unexpected) apply_errors += 1;
          } catch (e) {
            apply_errors += 1;
            apply_outcomes.RPC_ERROR = (apply_outcomes.RPC_ERROR ?? 0) + 1;
            console.warn(
              "agenda-sheet-reconcile apply exception",
              {
                spreadsheet_id: spreadsheetId,
                sheet_id: tab.sheetId,
                sheet_row: row.sheet_row,
                booking_id: row.booking_id,
                expediente_id: row.expediente_id,
                message: e instanceof Error
                  ? e.message.slice(0, 200)
                  : String(e).slice(0, 200),
              },
            );
          }
        }
      }
    }

    if (!applyEngineOn) {
      console.info("operational_apply_disabled", {
        enabled: applyConfig.enabled,
        from_date: applyConfig.fromDate,
        gate: applyGloballyAllowed.outcome,
        ops_upserted,
      });
    } else if (apply_before_cutover > 0) {
      console.info("operational_apply_before_cutover_summary", {
        from_date: applyConfig.fromDate,
        skipped_rows: apply_before_cutover,
      });
    }

    return jsonOk({
      upserted,
      ops_upserted,
      operational_apply_enabled: applyEngineOn,
      operational_apply_from_date: applyConfig.fromDate,
      apply_count,
      apply_skipped,
      apply_errors,
      apply_before_cutover,
      apply_outcomes,
      issues: allIssues.slice(0, 50),
      issue_count: allIssues.length,
      filter: {
        bookingDate: filterDate || null,
        kind: filterKind || null,
        locationId: filterLocation || null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("agenda-sheet-reconcile error", msg);
    return jsonError(
      500,
      "internal_error",
      `Reconcile falló: ${msg}`.slice(0, 280),
    );
  }
});
