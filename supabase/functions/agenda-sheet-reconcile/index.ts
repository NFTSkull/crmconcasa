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
    const allIssues: unknown[] = [];

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
    }

    return jsonOk({
      upserted,
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
