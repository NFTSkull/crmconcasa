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
import { createGoogleSheetsAdapter } from "../_shared/agenda-sheets/google.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonError(405, "method_not_allowed", "Solo POST");
    }
    if (Deno.env.get("GOOGLE_SHEETS_SYNC_ENABLED") === "false") {
      return jsonOk({ processed: 0, disabled: true });
    }

    const secret = Deno.env.get("GOOGLE_SHEETS_WEBHOOK_SECRET") ?? "";
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

        // Cancelación: marcar fila CANCELADA si hay mapping
        if (ev.event_type === "booking_cancelled" && link) {
          const title = String(link.sheet_title ?? "");
          const row = Number(link.row_number);
          const titleEsc = `'${title.replace(/'/g, "''")}'`;
          await adapter.updateValues(`${titleEsc}!H${row}:N${row}`, [[
            "CANCELADA",
            String(ev.booking_id ?? ""),
            String(payload.expediente_id ?? ""),
            "",
            "crm",
            new Date().toISOString(),
            String(Number(link.sync_version ?? 1) + 1),
          ]]);
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
          // Worker requiere sheet_id/title preconfigurados o mapeo por fecha;
          // en v1 deja pendiente si no hay mapa de pestaña.
          const tabMap = Deno.env.get("GOOGLE_SHEETS_TAB_MAP_JSON") ?? "{}";
          let tab: { sheetId: number; title: string } | null = null;
          try {
            const map = JSON.parse(tabMap) as Record<
              string,
              { sheetId: number; title: string }
            >;
            tab = map[date] ?? null;
          } catch {
            tab = null;
          }
          if (!tab) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: "missing_tab_map",
            });
            failed++;
            continue;
          }

          const titleEsc = `'${tab.title.replace(/'/g, "''")}'`;
          const grid = await adapter.getValues(`${titleEsc}!A1:N200`);
          // Buscar primera fila libre del bloque matching time/sede/kind
          // (implementación mínima: fila con hora parseable igual y NSS vacío y sin booking_id)
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
            const nssCell = String(grid[i]?.[1] ?? "").trim();
            const bookingCell = String(grid[i]?.[8] ?? "").trim();
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

          // Releer justo antes de escribir
          const fresh = await adapter.getValues(
            `${titleEsc}!A${targetRow}:N${targetRow}`,
          );
          const fr = fresh[0] ?? [];
          if (String(fr[1] ?? "").trim() || String(fr[8] ?? "").trim()) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: "row_occupied_race",
            });
            failed++;
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

          const horaKeep = String(fr[0] ?? "");
          await adapter.updateValues(`${titleEsc}!A${targetRow}:D${targetRow}`, [[
            horaKeep,
            String((exp as { nss?: string } | null)?.nss ?? ""),
            String((exp as { cliente_nombre?: string } | null)?.cliente_nombre ?? ""),
            String(
              (asesor as { full_name?: string; email?: string } | null)?.full_name ||
                (asesor as { email?: string } | null)?.email ||
                "",
            ),
          ]]);
          await adapter.updateValues(`${titleEsc}!H${targetRow}:N${targetRow}`, [[
            "SINCRONIZADO",
            String(ev.booking_id ?? ""),
            String(payload.expediente_id ?? ""),
            `${kind}|${date}|${time}|${locationId}|${ordinal}`,
            "crm",
            new Date().toISOString(),
            "1",
          ]]);

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
