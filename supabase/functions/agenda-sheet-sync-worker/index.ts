/**
 * Edge Function: agenda-sheet-sync-worker
 * Procesa outbox CRM → Sheets. Best-effort; no revierte bookings.
 */
import {
  DEFAULT_SPREADSHEET_ID,
  jsonError,
  jsonOk,
  parseTime,
} from "../_shared/agenda-sheets/parsers.ts";
import {
  COL_INDEX,
  a1FullReadRange,
  a1TechRange,
  a1VisibleRange,
  assertTechColumnsWritable,
  buildTechWriteRow,
} from "../_shared/agenda-sheets/tech-columns.ts";
import { createGoogleSheetsAdapter } from "../_shared/agenda-sheets/google.ts";
import {
  parseTabMapJson,
  resolveSheetTabForDate,
} from "../_shared/agenda-sheets/resolve-tab.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonError(405, "method_not_allowed", "Solo POST");
    }
    // Sync apagado: 2xx no-op sin tocar outbox/Sheets/bookings (cron-safe).
    if (Deno.env.get("GOOGLE_SHEETS_SYNC_ENABLED") === "false") {
      return jsonOk({ processed: 0, disabled: true });
    }

    // Auth: preferir GOOGLE_SHEETS_WORKER_SECRET; fallback WEBHOOK_SECRET (legado).
    const secret =
      (Deno.env.get("GOOGLE_SHEETS_WORKER_SECRET") ?? "").trim() ||
      (Deno.env.get("GOOGLE_SHEETS_WEBHOOK_SECRET") ?? "").trim();
    const hdr = req.headers.get("x-concasa-worker-secret") ??
      req.headers.get("x-concasa-webhook-secret") ?? "";
    // Misma comparación segura simple
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: events, error } = await supabase.rpc("agenda_sheet_claim_outbox", {
      p_limit: 10,
    });
    if (error) {
      return jsonError(500, "claim_failed", "No se pudo reclamar outbox");
    }

    const list = (events ?? []) as Array<Record<string, unknown>>;
    if (list.length === 0) return jsonOk({ processed: 0 });

    const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
    const pk = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "";
    const spreadsheetId =
      Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? DEFAULT_SPREADSHEET_ID;
    if (!email || !pk) {
      for (const ev of list) {
        await supabase.rpc("agenda_sheet_mark_outbox", {
          p_id: ev.id,
          p_status: "failed",
          p_error: "missing_google_creds",
        });
      }
      return jsonError(500, "missing_google_creds", "Credenciales no configuradas");
    }

    const adapter = await createGoogleSheetsAdapter({
      spreadsheetId,
      serviceAccountEmail: email,
      privateKeyPem: pk,
    });

    let done = 0;
    let failed = 0;
    for (const ev of list) {
      try {
        const payload = (ev.payload ?? {}) as Record<string, unknown>;
        // Si el booking nació desde Sheets, el mapping ya está; marcar done.
        const { data: links } = await supabase
          .from("agenda_sheet_slot_links")
          .select("id,sync_source,row_number,sheet_title,sheet_id")
          .eq("booking_id", ev.booking_id)
          .is("deleted_at", null)
          .limit(1);
        const link = (links ?? [])[0] as Record<string, unknown> | undefined;
        if (link?.sync_source === "sheets" && ev.event_type === "booking_created") {
          await supabase.rpc("agenda_sheet_mark_outbox", {
            p_id: ev.id,
            p_status: "done",
          });
          done++;
          continue;
        }

        // Cancelación: marcar fila CANCELADA en O:U si hay mapping (nunca H:N)
        if (ev.event_type === "booking_cancelled" && link) {
          const title = String(link.sheet_title ?? "");
          const row = Number(link.row_number);
          const bookingId = String(ev.booking_id ?? "");
          const fresh = await adapter.getValues(a1FullReadRange(title, row));
          const decision = assertTechColumnsWritable({
            existingRowOrTech: fresh[0] ?? [],
            bookingId,
          });
          if (!decision.ok) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: `tech_conflict:${decision.reason}`,
            });
            failed++;
            continue;
          }
          if (decision.mode === "write" || decision.mode === "idempotent") {
            await adapter.updateValues(a1TechRange(title, row), [buildTechWriteRow({
              estado: "CANCELADA",
              bookingId,
              expedienteId: String(payload.expediente_id ?? ""),
              slotKey: "",
              syncSource: "crm",
              syncUpdatedAt: new Date().toISOString(),
              syncVersion: Number(link.sync_version ?? 1) + 1,
            })]);
          }
          await supabase.rpc("agenda_sheet_mark_outbox", {
            p_id: ev.id,
            p_status: "done",
          });
          done++;
          continue;
        }

        // booking_created desde CRM: localizar fila libre del cupo
        if (ev.event_type === "booking_created" && !link) {
          const date = String(payload.booking_date ?? "");
          const timeRaw = String(payload.booking_time ?? "");
          const time = parseTime(timeRaw.slice(0, 5)) ?? timeRaw.slice(0, 5);
          const locationId = String(payload.location_id ?? "");
          const kind = String(payload.kind ?? "");
          const tabMap = parseTabMapJson(
            Deno.env.get("GOOGLE_SHEETS_TAB_MAP_JSON") ?? "{}",
          );
          const yearEnv = Number(Deno.env.get("GOOGLE_SHEETS_YEAR") ?? "2026");
          const liveTabs = await adapter.listSheets();
          const resolved = resolveSheetTabForDate({
            bookingDate: date,
            tabMap,
            liveTabs,
            year: Number.isFinite(yearEnv) ? yearEnv : undefined,
          });
          if (
            resolved.status === "missing_sheet_for_date" ||
            resolved.status === "ambiguous_sheet_for_date"
          ) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: resolved.status,
            });
            failed++;
            continue;
          }
          const tab = {
            sheetId: resolved.sheetId,
            title: resolved.title,
          };
          // resolved.status: resolved_from_tab_map | resolved_from_live_metadata
          void resolved.status;

          const titleEsc = `'${tab.title.replace(/'/g, "''")}'`;
          const grid = await adapter.getValues(`${titleEsc}!A1:U200`);
          // Buscar primera fila libre del bloque matching time/sede/kind
          let targetRow: number | null = null;
          let ordinal = 0;
          let sectionKind = "";
          let sectionSede = "";
          for (let i = 0; i < grid.length; i++) {
            const a = String(grid[i]?.[0] ?? "");
            const upper = a.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
            if (upper === "MONTERREY FIRMAS") {
              sectionKind = "firmas"; sectionSede = "monterrey"; ordinal = 0; continue;
            }
            if (upper === "MONTERREY BIOMETRICOS") {
              sectionKind = "biometricos"; sectionSede = "monterrey"; ordinal = 0; continue;
            }
            if (upper === "APODACA FIRMAS") {
              sectionKind = "firmas"; sectionSede = "apodaca"; ordinal = 0; continue;
            }
            if (upper === "APODACA BIOMETRICOS") {
              sectionKind = "biometricos"; sectionSede = "apodaca"; ordinal = 0; continue;
            }
            const t = parseTime(a);
            if (!t || sectionKind !== kind || sectionSede !== locationId) continue;
            if (t !== time) continue;
            ordinal += 1;
            const nssCell = String(grid[i]?.[COL_INDEX.nss] ?? "").trim();
            const bookingCell = String(grid[i]?.[COL_INDEX.bookingId] ?? "").trim();
            if (!nssCell && !bookingCell && targetRow == null) {
              targetRow = i + 1;
              break;
            }
          }
          if (targetRow == null) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: "no_free_sheet_row",
            });
            failed++;
            continue;
          }

          // Releer A:U justo antes de escribir
          const fresh = await adapter.getValues(
            a1FullReadRange(tab.title, targetRow),
          );
          const fr = fresh[0] ?? [];
          if (String(fr[COL_INDEX.nss] ?? "").trim()) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: "row_occupied_race",
            });
            failed++;
            continue;
          }
          const bookingId = String(ev.booking_id ?? "");
          const decision = assertTechColumnsWritable({
            existingRowOrTech: fr,
            bookingId,
          });
          if (!decision.ok) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: `tech_conflict:${decision.reason}`,
            });
            failed++;
            continue;
          }
          if (decision.mode === "idempotent") {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "done",
            });
            done++;
            continue;
          }

          // Datos canónicos desde expediente
          const { data: exp } = await supabase
            .from("expedientes")
            .select("id,nss,cliente_nombre,asesor_id")
            .eq("id", payload.expediente_id)
            .maybeSingle();
          const { data: asesor } = await supabase
            .from("profiles")
            .select("full_name,email")
            .eq("id", (exp as { asesor_id?: string } | null)?.asesor_id ?? "")
            .maybeSingle();

          const horaKeep = String(fr[COL_INDEX.hora] ?? "");
          // Solo A:D + O:U. Nunca H:N / E:N.
          await adapter.updateValues(a1VisibleRange(tab.title, targetRow), [[
            horaKeep,
            String((exp as { nss?: string } | null)?.nss ?? ""),
            String((exp as { cliente_nombre?: string } | null)?.cliente_nombre ?? ""),
            String(
              (asesor as { full_name?: string; email?: string } | null)?.full_name ||
                (asesor as { email?: string } | null)?.email ||
                "",
            ),
          ]]);
          await adapter.updateValues(a1TechRange(tab.title, targetRow), [buildTechWriteRow({
            estado: "SINCRONIZADO",
            bookingId,
            expedienteId: String(payload.expediente_id ?? ""),
            slotKey: `${kind}|${date}|${time}|${locationId}|${ordinal}`,
            syncSource: "crm",
            syncUpdatedAt: new Date().toISOString(),
            syncVersion: 1,
          })]);

          await supabase.rpc("agenda_sheet_upsert_link_from_crm", {
            p_organization_id: payload.organization_id,
            p_spreadsheet_id: spreadsheetId,
            p_sheet_id: tab.sheetId,
            p_sheet_title: tab.title,
            p_sheet_date: date,
            p_row_number: targetRow,
            p_location_id: locationId,
            p_kind: kind,
            p_slot_time: time,
            p_slot_ordinal: ordinal,
            p_booking_id: ev.booking_id,
            p_sync_status: "SINCRONIZADO",
          });

          await supabase.rpc("agenda_sheet_mark_outbox", {
            p_id: ev.id,
            p_status: "done",
          });
          done++;
          continue;
        }

        await supabase.rpc("agenda_sheet_mark_outbox", {
          p_id: ev.id,
          p_status: "failed",
          p_error: "unhandled_event",
        });
        failed++;
      } catch (err) {
        await supabase.rpc("agenda_sheet_mark_outbox", {
          p_id: ev.id,
          p_status: "failed",
          p_error: String(err).slice(0, 400),
        });
        failed++;
      }
    }

    return jsonOk({ processed: list.length, done, failed });
  } catch (e) {
    console.error("agenda-sheet-sync-worker error", String(e));
    return jsonError(500, "internal_error", "Worker falló");
  }
});
