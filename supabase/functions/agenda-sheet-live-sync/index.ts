/**
 * Edge Function: agenda-sheet-live-sync
 * Refresh dirigido Sheet → inventario ANTES de listar disponibilidad / hard gate book.
 * Auth: JWT usuario (asesor/mesa/admin/editor) o worker secret.
 * Relee Google Sheets; upsert inventory; no crea agenda_booking falso.
 */
import {
  DEFAULT_SPREADSHEET_ID,
  jsonError,
  jsonOk,
  parseTabDate,
  timingSafeEqual,
} from "../_shared/agenda-sheets/parsers.ts";
import { createGoogleSheetsAdapter } from "../_shared/agenda-sheets/google.ts";
import { buildInventoryUpsertRows } from "../_shared/agenda-sheets/inventory-from-grid.ts";
import type { AgendaSheetTimeAlias } from "../_shared/agenda-sheets/time-aliases.ts";
import {
  BOOK_SLOT_JUST_TAKEN_MESSAGE,
  countAvailableByPhysicalOccupancy,
  decideBookHardGate,
} from "../_shared/agenda-sheets/manual-occupancy.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const START = "2026-07-30";

type Body = {
  bookingDate?: string;
  kind?: "biometricos" | "firmas" | "inscripcion";
  locationId?: "monterrey" | "apodaca";
  mode?: "availability" | "book_gate";
  slotTime?: string;
};

const LIVE_SYNC_ROLES = [
  "asesor",
  "editor",
  "mesa_admin",
  "mesa_interno",
  "mesa_externo",
  "super_admin",
] as const;

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonError(405, "method_not_allowed", "Solo POST");
    }
    if (Deno.env.get("GOOGLE_SHEETS_SYNC_ENABLED") === "false") {
      return jsonOk({ refreshed: false, disabled: true, slots: [] });
    }

    const workerSecret =
      (Deno.env.get("GOOGLE_SHEETS_WORKER_SECRET") ?? "").trim() ||
      (Deno.env.get("GOOGLE_SHEETS_WEBHOOK_SECRET") ?? "").trim();
    const hdrSecret =
      req.headers.get("x-concasa-worker-secret") ??
      req.headers.get("x-concasa-webhook-secret") ??
      "";
    const workerOk =
      Boolean(workerSecret) && timingSafeEqual(hdrSecret, workerSecret);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      return jsonError(500, "missing_config", "Faltan credenciales Supabase");
    }

    const authHdr = req.headers.get("Authorization") ?? "";
    let userOk = false;
    if (!workerOk && authHdr.toLowerCase().startsWith("bearer ")) {
      const userClient = createClient(supabaseUrl, anonKey || serviceKey, {
        global: { headers: { Authorization: authHdr } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (!userErr && userData.user) {
        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: profile, error: profileErr } = await admin
          .from("profiles")
          .select("app_role,active")
          .eq("id", userData.user.id)
          .maybeSingle();
        if (profileErr) {
          console.error("agenda-sheet-live-sync profile query", {
            message: String(profileErr.message ?? "").slice(0, 200),
            code: String((profileErr as { code?: string }).code ?? "").slice(
              0,
              40,
            ),
          });
          userOk = false;
        } else {
          const role = String(
            (profile as { app_role?: string } | null)?.app_role ?? "",
          );
          const active =
            (profile as { active?: boolean } | null)?.active !== false;
          userOk =
            active &&
            (LIVE_SYNC_ROLES as readonly string[]).includes(role);
        }
      }
    }
    if (!workerOk && !userOk) {
      return jsonError(401, "unauthorized", "No autorizado");
    }

    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      body = {};
    }

    const bookingDate = String(body.bookingDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) || bookingDate < START) {
      return jsonError(400, "invalid_date", "bookingDate inválida o fuera de inventario");
    }
    const kind = body.kind;
    const locationId = body.locationId;
    const mode = body.mode === "book_gate" ? "book_gate" : "availability";
    const slotTime = String(body.slotTime ?? "").trim().slice(0, 5);

    const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
    const pk = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "";
    const spreadsheetId =
      Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? DEFAULT_SPREADSHEET_ID;
    const orgId = Deno.env.get("GOOGLE_SHEETS_ORGANIZATION_ID") ?? "";
    const year = Number(Deno.env.get("GOOGLE_SHEETS_YEAR") ?? "2026");
    if (!email || !pk || !orgId) {
      return jsonError(500, "missing_config", "Faltan credenciales/org Google");
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
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

    const tabs = await adapter.listSheets();
    let upserted = 0;
    const anomalies: unknown[] = [];
    const physicalForGate: { slotTime: string; status: string }[] = [];

    for (const tab of tabs) {
      if (tab.hidden) continue;
      const titleRaw = String(tab.title ?? "");
      const titleCmp = titleRaw.trim();
      if (/^FORMATO$/i.test(titleCmp)) continue;
      const date = parseTabDate(titleCmp, Number.isFinite(year) ? year : 2026);
      if (!date || date !== bookingDate) continue;

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
      for (const iss of issues) {
        anomalies.push({ title: titleRaw, ...iss });
      }

      const filtered = rows.filter((r) => {
        if (kind && r.kind !== kind) return false;
        if (locationId && r.location_id !== locationId) return false;
        return true;
      });

      for (const r of filtered) {
        physicalForGate.push({
          slotTime: String(r.slot_time).slice(0, 5),
          status: r.status,
        });
      }

      for (let i = 0; i < filtered.length; i += 200) {
        const chunk = filtered.slice(i, i + 200);
        if (chunk.length === 0) continue;
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

    // Siempre calcular cupo desde la relectura física (no depender de RPC user-scoped).
    const byTime = new Map<string, { available: number; physical_total: number }>();
    const times = new Set(physicalForGate.map((p) => p.slotTime));
    for (const t of times) {
      if (kind || locationId) {
        // physicalForGate ya filtrado
      }
      const c = countAvailableByPhysicalOccupancy(
        physicalForGate.map((p) => ({
          slotTime: p.slotTime,
          status: p.status as
            | "available"
            | "occupied_external"
            | "linked"
            | "claimed"
            | "disabled"
            | "conflict",
        })),
        t,
      );
      byTime.set(t, {
        available: c.available,
        physical_total: c.physicalTotal,
      });
    }
    const slots = [...byTime.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([slot_time, v]) => ({
        slot_time,
        available: v.available,
        physical_total: v.physical_total,
      }));

    let canBook = true;
    let gateMessage: string | null = null;
    if (mode === "book_gate") {
      if (!/^\d{2}:\d{2}$/.test(slotTime)) {
        return jsonError(400, "invalid_slot_time", "slotTime requerido en book_gate");
      }
      const live = byTime.get(slotTime)?.available ?? 0;
      const gate = decideBookHardGate({ liveAvailableForSlot: live });
      canBook = gate.allow;
      gateMessage = gate.message;
    }

    return jsonOk({
      ok: true,
      refreshed: true,
      upserted,
      anomalies: anomalies.slice(0, 50),
      anomaly_count: anomalies.length,
      fresh: true,
      enforced: bookingDate >= START,
      slots,
      canBook,
      gateMessage,
      bookMessage: BOOK_SLOT_JUST_TAKEN_MESSAGE,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("agenda-sheet-live-sync error", msg);
    return jsonError(500, "internal_error", msg.slice(0, 280));
  }
});
