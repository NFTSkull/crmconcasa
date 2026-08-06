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
  a1BdRange,
  a1FullReadRange,
  a1TechRange,
  assertTechColumnsWritable,
  buildTechWriteRow,
} from "../_shared/agenda-sheets/tech-columns.ts";
import {
  cancelClearBatchRanges,
  classifyCancelRowClearance,
  snapshotPreserveGN,
  summarizeLiveRowAU,
  verifyClearedRowReadback,
} from "../_shared/agenda-sheets/cancel-row-clearance.ts";
import {
  decideCancelMissingCoords,
  decidePriorCancelGate,
  hadSheetEvidenceFromPayload,
  resolveCancelSheetCoords,
  shouldRestorePriorAfterCreateFailure,
  sortOutboxForRescheduleMove,
  type ClearedRowRestoreSnapshot,
} from "../_shared/agenda-sheets/reschedule-sheet-move.ts";
import { createGoogleSheetsAdapter } from "../_shared/agenda-sheets/google.ts";
import {
  parseTabMapJson,
  resolveSheetTabForDate,
} from "../_shared/agenda-sheets/resolve-tab.ts";
import {
  buildPhysicalSheetRowKey,
  resolvePhysicalSheetTimes,
  resolveSheetStartTime,
  type AgendaSheetTimeAlias,
} from "../_shared/agenda-sheets/time-aliases.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonError(405, "method_not_allowed", "Solo POST");
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

    let bodyJson: Record<string, unknown> = {};
    try {
      bodyJson = (await req.json()) as Record<string, unknown>;
    } catch {
      bodyJson = {};
    }

    const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
    const pk = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "";
    const spreadsheetId =
      Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? DEFAULT_SPREADSHEET_ID;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    /**
     * Dry-run admin read-only: lee A:U live y clasifica sin escribir Sheet/outbox.
     * Body: { dry_run_cancel_cleanup: true, targets: [{ booking_id, sheet_title?, sheet_row?, sheet_id? }] }
     */
    if (bodyJson.dry_run_cancel_cleanup === true) {
      if (!email || !pk) {
        return jsonError(500, "missing_google_creds", "Credenciales no configuradas");
      }
      const adapter = await createGoogleSheetsAdapter({
        spreadsheetId,
        serviceAccountEmail: email,
        privateKeyPem: pk,
      });
      const targets = Array.isArray(bodyJson.targets)
        ? (bodyJson.targets as Array<Record<string, unknown>>)
        : [];
      const report = [];
      for (const t of targets) {
        const bookingId = String(t.booking_id ?? "");
        let title = String(t.sheet_title ?? "");
        let row = Number(t.sheet_row ?? 0);
        let sheetId = Number(t.sheet_id ?? 0);
        if ((!title || !(row > 0)) && bookingId) {
          const { data: invRows } = await supabase
            .from("agenda_sheet_slot_inventory")
            .select("sheet_row,sheet_title,sheet_id")
            .eq("booking_id", bookingId)
            .limit(1);
          const inv = (invRows ?? [])[0] as Record<string, unknown> | undefined;
          if (inv) {
            title = String(inv.sheet_title ?? title);
            row = Number(inv.sheet_row ?? row);
            sheetId = Number(inv.sheet_id ?? sheetId);
          }
        }
        if (sheetId > 0) {
          try {
            const liveTabs = await adapter.listSheets();
            const hit = liveTabs.find((x) => Number(x.sheetId) === sheetId);
            if (hit?.title) title = hit.title;
          } catch { /* keep */ }
        }
        if (!(row > 0) || !title) {
          report.push({
            booking_id: bookingId,
            classification: "ambiguous",
            reason: "sin fila/título",
            live: null,
          });
          continue;
        }
        const live = await adapter.getValues(a1FullReadRange(title, row));
        const fr = live[0] ?? [];
        const decision = classifyCancelRowClearance({
          row: fr,
          cancelledBookingId: bookingId,
          cancelledExpedienteId: t.expediente_id
            ? String(t.expediente_id)
            : undefined,
        });
        report.push({
          booking_id: bookingId,
          sheetId,
          sheet_title: title,
          row_number: row,
          live: summarizeLiveRowAU(fr),
          clear_ranges: decision.classification === "safe_to_clear"
            ? cancelClearBatchRanges(title, row)
            : [],
          classification: decision.classification,
          reason: decision.reason,
          conflictingColumns: decision.conflictingColumns,
          terminalNoRetry: decision.terminalNoRetry,
        });
      }
      return jsonOk({ dry_run: true, spreadsheetId, report });
    }

    // Sync apagado: 2xx no-op sin tocar outbox/Sheets/bookings (cron-safe).
    if (Deno.env.get("GOOGLE_SHEETS_SYNC_ENABLED") === "false") {
      return jsonOk({ processed: 0, disabled: true });
    }

    const { data: events, error } = await supabase.rpc("agenda_sheet_claim_outbox", {
      p_limit: 10,
    });
    if (error) {
      return jsonError(500, "claim_failed", "No se pudo reclamar outbox");
    }

    const claimed = (events ?? []) as Array<Record<string, unknown>>;
    if (claimed.length === 0) return jsonOk({ processed: 0 });
    // Reagenda = cancel+create: procesar limpieza antes de escribir la nueva fila.
    const list = sortOutboxForRescheduleMove(claimed);

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

    let timeAliases: AgendaSheetTimeAlias[] = [];
    try {
      const { data: aliasJson } = await supabase.rpc(
        "agenda_sheet_list_time_aliases",
        { p_organization_id: null },
      );
      if (Array.isArray(aliasJson)) {
        timeAliases = aliasJson as AgendaSheetTimeAlias[];
      }
    } catch {
      timeAliases = [];
    }

    /** Snapshots de filas limpiadas en este claim (restore best-effort si create falla). */
    const clearedByBooking = new Map<string, ClearedRowRestoreSnapshot>();

    /** Título exacto de Google por sheetId (conserva trailing spaces). */
    const resolveLiveTitle = async (
      sheetId: number,
      fallbackTitle: string,
    ): Promise<string> => {
      if (!Number.isFinite(sheetId) || sheetId <= 0) return fallbackTitle;
      try {
        const liveTabs = await adapter.listSheets();
        const hit = liveTabs.find((t) => Number(t.sheetId) === Number(sheetId));
        if (hit?.title) return hit.title;
      } catch {
        // best-effort: conservar fallback
      }
      return fallbackTitle;
    };

    /** Best-effort: reescribe B:D+O:U de la cita anterior si create falló tras clear. */
    const restorePriorSheetRow = async (priorBookingId: string) => {
      const snap = clearedByBooking.get(priorBookingId);
      if (
        !shouldRestorePriorAfterCreateFailure({
          createFailed: true,
          priorClearedInBatch: true,
          restoreSnapshot: snap,
        }) ||
        !snap
      ) {
        return;
      }
      try {
        await adapter.batchUpdateValues([
          {
            range: a1BdRange(snap.sheetTitle, snap.sheetRow),
            values: [[snap.visibleBCD[0], snap.visibleBCD[1], snap.visibleBCD[2]]],
          },
          {
            range: a1TechRange(snap.sheetTitle, snap.sheetRow),
            values: [[...snap.techOU]],
          },
        ]);
      } catch (restoreErr) {
        console.error(
          "restore_prior_sheet_failed",
          priorBookingId,
          String(restoreErr),
        );
      }
    };

    let done = 0;
    let failed = 0;
    for (const ev of list) {
      try {
        const payload = (ev.payload ?? {}) as Record<string, unknown>;
        // Si el booking nació desde Sheets, el mapping ya está; marcar done.
        const { data: links } = await supabase
          .from("agenda_sheet_slot_links")
          .select("id,sync_source,row_number,sheet_title,sheet_id,sync_version")
          .eq("booking_id", ev.booking_id)
          .is("deleted_at", null)
          .limit(3);
        const link = (links ?? [])[0] as Record<string, unknown> | undefined;
        if (
          ev.event_type === "booking_created" &&
          (links ?? []).length >= 2
        ) {
          await supabase.rpc("agenda_sheet_mark_outbox", {
            p_id: ev.id,
            p_status: "dead",
            p_error: `duplicate_booking_row:links=${(links ?? []).length}`,
          });
          failed++;
          continue;
        }
        if (link?.sync_source === "sheets" && ev.event_type === "booking_created") {
          await supabase.rpc("agenda_sheet_mark_outbox", {
            p_id: ev.id,
            p_status: "done",
          });
          done++;
          continue;
        }

        // Cancelación / cleanup: batchClear SOLO B:D + O:U; nunca escribe A ni G:N.
        if (
          ev.event_type === "booking_cancelled" ||
          ev.event_type === "booking_cancelled_cleanup"
        ) {
          const bookingId = String(ev.booking_id ?? "");
          let softLink: Record<string, unknown> | undefined;
          if ((!link || !(Number(link.row_number) > 0)) && bookingId) {
            const { data: softLinks } = await supabase
              .from("agenda_sheet_slot_links")
              .select("row_number,sheet_title,sheet_id")
              .eq("booking_id", bookingId)
              .not("deleted_at", "is", null)
              .order("deleted_at", { ascending: false })
              .limit(1);
            softLink = (softLinks ?? [])[0] as Record<string, unknown> | undefined;
          }
          let inv: Record<string, unknown> | undefined;
          if (bookingId) {
            const { data: invRows } = await supabase
              .from("agenda_sheet_slot_inventory")
              .select("id,sheet_row,sheet_title,sheet_id")
              .eq("booking_id", bookingId)
              .limit(1);
            inv = (invRows ?? [])[0] as Record<string, unknown> | undefined;
          }
          const coords = resolveCancelSheetCoords({
            payloadSheetId: Number(payload.sheet_id ?? 0) || null,
            payloadSheetTitle: payload.sheet_title
              ? String(payload.sheet_title)
              : null,
            payloadSheetRow: Number(payload.sheet_row ?? 0) || null,
            payloadInventoryId: payload.inventory_id
              ? String(payload.inventory_id)
              : null,
            activeLink: link
              ? {
                  sheetId: Number(link.sheet_id ?? 0) || null,
                  sheetTitle: link.sheet_title
                    ? String(link.sheet_title)
                    : null,
                  rowNumber: Number(link.row_number ?? 0) || null,
                }
              : null,
            softDeletedLink: softLink
              ? {
                  sheetId: Number(softLink.sheet_id ?? 0) || null,
                  sheetTitle: softLink.sheet_title
                    ? String(softLink.sheet_title)
                    : null,
                  rowNumber: Number(softLink.row_number ?? 0) || null,
                }
              : null,
            inventory: inv
              ? {
                  sheetId: Number(inv.sheet_id ?? 0) || null,
                  sheetTitle: inv.sheet_title ? String(inv.sheet_title) : null,
                  sheetRow: Number(inv.sheet_row ?? 0) || null,
                  inventoryId: inv.id ? String(inv.id) : null,
                }
              : null,
          });
          let title = String(coords.sheetTitle ?? "");
          const row = Number(coords.sheetRow ?? 0);
          const sheetId = Number(coords.sheetId ?? 0);
          if (!(row > 0) || !title) {
            const evidence =
              hadSheetEvidenceFromPayload(payload) ||
              Boolean(link) ||
              Boolean(softLink) ||
              Boolean(inv);
            const missing = decideCancelMissingCoords({
              hadSheetEvidence: evidence,
            });
            if (missing === "failed_missing_coords") {
              await supabase.rpc("agenda_sheet_mark_outbox", {
                p_id: ev.id,
                p_status: "failed",
                p_error: "missing_sheet_coords_for_cancel",
              });
              failed++;
              continue;
            }
            await supabase.rpc("agenda_sheet_mark_cancelled_cleared", {
              p_booking_id: bookingId,
            });
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "done",
            });
            done++;
            continue;
          }
          title = await resolveLiveTitle(sheetId, title);

          // Último read antes de clear (carrera / reuso).
          const fresh = await adapter.getValues(a1FullReadRange(title, row));
          const fr = fresh[0] ?? [];
          const horaBefore = String(fr[0] ?? "");
          const gnBefore = snapshotPreserveGN(fr);
          const decision = classifyCancelRowClearance({
            row: fr,
            cancelledBookingId: bookingId,
            cancelledExpedienteId: String(payload.expediente_id ?? ""),
          });

          if (decision.classification === "already_absent") {
            await supabase.rpc("agenda_sheet_mark_cancelled_cleared", {
              p_booking_id: bookingId,
            });
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "done",
            });
            done++;
            continue;
          }

          if (decision.classification === "row_reused") {
            // Fila reutilizada: cancelación anterior already_absent; no tocar booking nuevo.
            await supabase.rpc("agenda_sheet_mark_cancelled_cleared", {
              p_booking_id: bookingId,
            });
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "done",
            });
            done++;
            continue;
          }

          if (
            decision.classification === "not_crm_owned" ||
            decision.classification === "ambiguous"
          ) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "dead",
              p_error:
                `${decision.classification}:${title}:row=${row}:${decision.reason}`
                  .slice(0, 500),
            });
            failed++;
            continue;
          }

          if (decision.classification === "manual_result_conflict") {
            // Terminal: no reintentar; conservar metadata O:U para rastreo.
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "dead",
              p_error:
                `manual_result_conflict:sheetId=${sheetId}:title=${title}:row=${row}:cols=${
                  decision.conflictingColumns.join(",")
                }`.slice(0, 500),
            });
            failed++;
            continue;
          }

          // safe_to_clear → values.batchClear únicamente B:D y O:U
          const clearRanges = cancelClearBatchRanges(title, row);
          const preClearRow = fr;
          await adapter.batchClear(clearRanges);

          const verify = await adapter.getValues(a1FullReadRange(title, row));
          const vr = verifyClearedRowReadback({
            row: verify[0] ?? [],
            expectedHora: horaBefore,
            expectedGN: gnBefore,
            expectedEFEmpty: true,
          });
          if (!vr.ok) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: `write_verify_failed:${vr.reason ?? "clear"}`,
            });
            failed++;
            continue;
          }

          clearedByBooking.set(bookingId, {
            bookingId,
            expedienteId: String(payload.expediente_id ?? ""),
            sheetTitle: title,
            sheetRow: row,
            visibleBCD: [
              String(preClearRow[1] ?? ""),
              String(preClearRow[2] ?? ""),
              String(preClearRow[3] ?? ""),
            ],
            techOU: [14, 15, 16, 17, 18, 19, 20].map((i) =>
              String(preClearRow[i] ?? ""),
            ),
          });

          await supabase.rpc("agenda_sheet_mark_cancelled_cleared", {
            p_booking_id: bookingId,
          });
          await supabase.rpc("agenda_sheet_mark_outbox", {
            p_id: ev.id,
            p_status: "done",
          });
          done++;
          continue;
        }

        // booking_rescheduled (UPDATE in-place raro): tratar como cancel de coords payload.
        if (ev.event_type === "booking_rescheduled") {
          await supabase.rpc("agenda_sheet_mark_outbox", {
            p_id: ev.id,
            p_status: "failed",
            p_error:
              "booking_rescheduled_use_cancel_create:reagendar_rpc_emits_cancel_plus_create",
          });
          failed++;
          continue;
        }

        // booking_created desde CRM: escribir SOLO en fila preasignada del inventario
        if (ev.event_type === "booking_created" && !link) {
          const date = String(payload.booking_date ?? "");
          const timeRaw = String(payload.booking_time ?? "");
          const time = parseTime(timeRaw.slice(0, 5)) ?? timeRaw.slice(0, 5);
          const locationId = String(payload.location_id ?? "");
          const kind = String(payload.kind ?? "");
          const bookingId = String(ev.booking_id ?? "");
          const priorId = String(payload.prior_cancelled_booking_id ?? "").trim();

          // Gate: no escribir nueva fila si la anterior del reagendo no está limpia.
          if (priorId) {
            const { data: priorOutbox } = await supabase
              .from("agenda_sheet_sync_outbox")
              .select("id,status,event_type")
              .eq("booking_id", priorId)
              .in("event_type", [
                "booking_cancelled",
                "booking_cancelled_cleanup",
              ])
              .in("status", ["pending", "processing", "failed"])
              .limit(1);
            const { data: priorActiveLinks } = await supabase
              .from("agenda_sheet_slot_links")
              .select("id")
              .eq("booking_id", priorId)
              .is("deleted_at", null)
              .limit(1);
            let priorSheetOwned = false;
            const priorSnap = clearedByBooking.get(priorId);
            if (!priorSnap) {
              // Si no limpiamos en este batch, mirar payload prior coords / inventario liberado no ayuda;
              // links activos ya cubren el caso típico. Opcional: read Sheet si hay coords en outbox done payload.
              const { data: priorDone } = await supabase
                .from("agenda_sheet_sync_outbox")
                .select("payload,status")
                .eq("booking_id", priorId)
                .in("event_type", [
                  "booking_cancelled",
                  "booking_cancelled_cleanup",
                ])
                .eq("status", "done")
                .limit(1);
              const donePayload = (priorDone?.[0]?.payload ?? {}) as Record<
                string,
                unknown
              >;
              const pTitle = String(
                donePayload.sheet_title ?? payload.prior_sheet_title ?? "",
              );
              const pRow = Number(
                donePayload.sheet_row ?? payload.prior_sheet_row ?? 0,
              );
              if (pTitle && pRow > 0) {
                try {
                  const live = await adapter.getValues(
                    a1FullReadRange(pTitle, pRow),
                  );
                  const liveP = String(live[0]?.[COL_INDEX.bookingId] ?? "").trim();
                  priorSheetOwned = liveP === priorId;
                } catch {
                  priorSheetOwned = false;
                }
              }
            }
            const gate = decidePriorCancelGate({
              priorCancelledBookingId: priorId,
              priorCancelOutboxPending: (priorOutbox ?? []).length > 0,
              priorActiveLinkExists: (priorActiveLinks ?? []).length > 0,
              priorSheetRowStillOwned: priorSheetOwned,
            });
            if (!gate.allowCreate) {
              await supabase.rpc("agenda_sheet_mark_outbox", {
                p_id: ev.id,
                p_status: "failed",
                p_error: gate.reason,
              });
              failed++;
              continue;
            }
          }

          // Dedup por booking_id exacto: links activos (nunca solo NSS/nombre).
          const { data: existingLinks } = await supabase
            .from("agenda_sheet_slot_links")
            .select(
              "id,row_number,sheet_title,sheet_id,sync_source,sync_version,sheet_date,location_id,kind,slot_time,slot_ordinal",
            )
            .eq("booking_id", bookingId)
            .is("deleted_at", null)
            .limit(5);
          const activeLinks = existingLinks ?? [];
          if (activeLinks.length >= 2) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "dead",
              p_error: `duplicate_booking_row:links=${activeLinks.length}`,
            });
            failed++;
            continue;
          }
          if (activeLinks.length === 1) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "done",
            });
            done++;
            continue;
          }

          // Inventario con mismo booking_id: metadata ya escrita → recuperar link, no reclamar otra fila.
          const { data: invByBooking } = await supabase
            .from("agenda_sheet_slot_inventory")
            .select(
              "id,sheet_row,sheet_title,sheet_id,slot_key,slot_time,sheet_slot_time,status,sheet_date,location_id,kind",
            )
            .eq("booking_id", bookingId)
            .limit(5);
          const invHits = invByBooking ?? [];
          if (invHits.length >= 2) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "dead",
              p_error: `duplicate_booking_row:inventory=${invHits.length}`,
            });
            failed++;
            continue;
          }
          if (invHits.length === 1) {
            const inv0 = invHits[0] as Record<string, unknown>;
            const invTitle = await resolveLiveTitle(
              Number(inv0.sheet_id ?? 0),
              String(inv0.sheet_title ?? ""),
            );
            const invRow = Number(inv0.sheet_row ?? 0);
            if (invTitle && invRow > 0) {
              const live = await adapter.getValues(
                a1FullReadRange(invTitle, invRow),
              );
              const lr = live[0] ?? [];
              const metaP = String(lr[COL_INDEX.bookingId] ?? "").trim();
              if (metaP === bookingId) {
                await supabase.rpc("agenda_sheet_upsert_link_from_crm", {
                  p_organization_id: payload.organization_id,
                  p_spreadsheet_id: spreadsheetId,
                  p_sheet_id: Number(inv0.sheet_id ?? 0),
                  p_sheet_title: invTitle,
                  p_sheet_date: String(inv0.sheet_date ?? date),
                  p_row_number: invRow,
                  p_location_id: String(inv0.location_id ?? locationId),
                  p_kind: String(inv0.kind ?? kind),
                  p_slot_time: String(inv0.slot_time ?? time).slice(0, 8),
                  p_slot_ordinal: 1,
                  p_booking_id: ev.booking_id,
                  p_sync_status: "SINCRONIZADO",
                });
                await supabase.rpc("agenda_sheet_inventory_mark_linked", {
                  p_booking_id: bookingId,
                  p_sheet_row: invRow,
                });
                await supabase.rpc("agenda_sheet_mark_outbox", {
                  p_id: ev.id,
                  p_status: "done",
                });
                done++;
                continue;
              }
            }
          }

          let targetRow = Number(payload.sheet_row ?? 0);
          let tabTitle = String(payload.sheet_title ?? "");
          let tabSheetId = Number(payload.sheet_id ?? 0);
          let slotKeyFromInv = "";
          let sheetSlotTimeFromInv: string | null = null;
          const ordinal = 1;

          if (!Number.isFinite(targetRow) || targetRow <= 0 || !tabTitle) {
            const inv = invHits[0] as Record<string, unknown> | undefined;
            if (inv) {
              targetRow = Number(inv.sheet_row);
              tabTitle = String(inv.sheet_title ?? "");
              tabSheetId = Number(inv.sheet_id ?? 0);
              slotKeyFromInv = String(inv.slot_key ?? "");
              if (inv.sheet_slot_time != null) {
                sheetSlotTimeFromInv = String(inv.sheet_slot_time).slice(0, 5);
              }
            } else {
              const { data: invRows } = await supabase
                .from("agenda_sheet_slot_inventory")
                .select(
                  "sheet_row,sheet_title,sheet_id,slot_key,slot_time,sheet_slot_time",
                )
                .eq("booking_id", bookingId)
                .in("status", ["claimed", "linked"])
                .limit(1);
              const inv2 = (invRows ?? [])[0] as Record<string, unknown> | undefined;
              if (inv2) {
                targetRow = Number(inv2.sheet_row);
                tabTitle = String(inv2.sheet_title ?? "");
                tabSheetId = Number(inv2.sheet_id ?? 0);
                slotKeyFromInv = String(inv2.slot_key ?? "");
                if (inv2.sheet_slot_time != null) {
                  sheetSlotTimeFromInv = String(inv2.sheet_slot_time).slice(0, 5);
                }
              }
            }
          } else if (payload.inventory_id) {
            const { data: invOne } = await supabase
              .from("agenda_sheet_slot_inventory")
              .select("slot_key,sheet_id,sheet_title,sheet_slot_time")
              .eq("id", payload.inventory_id)
              .maybeSingle();
            const invOneRec = invOne as {
              slot_key?: string;
              sheet_id?: number;
              sheet_title?: string;
              sheet_slot_time?: string;
            } | null;
            slotKeyFromInv = String(invOneRec?.slot_key ?? "");
            if (!tabSheetId && invOneRec?.sheet_id) {
              tabSheetId = Number(invOneRec.sheet_id);
            }
            if (!tabTitle && invOneRec?.sheet_title) {
              tabTitle = String(invOneRec.sheet_title);
            }
            if (invOneRec?.sheet_slot_time != null) {
              sheetSlotTimeFromInv = String(invOneRec.sheet_slot_time).slice(0, 5);
            }
          }

          if (!Number.isFinite(targetRow) || targetRow <= 0 || !tabTitle) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: "no_preassigned_sheet_row",
            });
            failed++;
            continue;
          }

          if (!tabSheetId) {
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
            tabSheetId = resolved.sheetId;
            tabTitle = resolved.title;
          }

          // Siempre preferir título live por sheetId (evita btrim histórico).
          tabTitle = await resolveLiveTitle(tabSheetId, tabTitle);
          if (payload.inventory_id && tabTitle) {
            await supabase
              .from("agenda_sheet_slot_inventory")
              .update({ sheet_title: tabTitle })
              .eq("id", payload.inventory_id);
          }

          const tab = { sheetId: tabSheetId, title: tabTitle };

          // Releer A:U de la fila preasignada — no buscar otra
          const fresh = await adapter.getValues(
            a1FullReadRange(tab.title, targetRow),
          );
          const fr = fresh[0] ?? [];
          // Si P ya tiene este booking_id exacto → no escribir de nuevo; recuperar link.
          const existingP = String(fr[COL_INDEX.bookingId] ?? "").trim();
          if (existingP === bookingId) {
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
            await supabase.rpc("agenda_sheet_inventory_mark_linked", {
              p_booking_id: bookingId,
              p_sheet_row: targetRow,
            });
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "done",
            });
            done++;
            continue;
          }
          const horaCell = parseTime(String(fr[COL_INDEX.hora] ?? ""));
          const physicalPool = resolvePhysicalSheetTimes({
            aliases: timeAliases,
            locationId,
            kind,
            logicalStartTime: time,
          });
          const expectedSheetTime =
            parseTime(sheetSlotTimeFromInv ?? "") ??
            resolveSheetStartTime({
              aliases: timeAliases,
              locationId,
              kind,
              logicalStartTime: time,
            });
          // A debe coincidir con algún físico del pool (p.ej. 10:00 o 11:00 para lógico 10:00).
          if (
            horaCell &&
            !physicalPool.includes(horaCell) &&
            horaCell !== expectedSheetTime
          ) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: "sheet_row_conflict:hora",
            });
            if (payload.inventory_id) {
              await supabase.rpc("agenda_sheet_inventory_mark_conflict", {
                p_id: payload.inventory_id,
                p_error: "hora_mismatch",
              });
            }
            failed++;
            continue;
          }
          const nssNow = String(fr[COL_INDEX.nss] ?? "").trim();
          const bookingCell = String(fr[COL_INDEX.bookingId] ?? "").trim();
          if (nssNow && bookingCell && bookingCell !== bookingId) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: "sheet_row_conflict",
            });
            failed++;
            continue;
          }
          if (nssNow && !bookingCell) {
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: "sheet_row_conflict",
            });
            failed++;
            continue;
          }
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
            await supabase.rpc("agenda_sheet_inventory_mark_linked", {
              p_booking_id: bookingId,
              p_sheet_row: targetRow,
            });
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "done",
            });
            done++;
            continue;
          }

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

          const horaSnapshot = String(fr[COL_INDEX.hora] ?? "");
          const preserveEN = Array.from({ length: 10 }, (_, i) =>
            String(fr[4 + i] ?? ""),
          );
          const expectedNss = String((exp as { nss?: string } | null)?.nss ?? "").trim();
          const expectedName = String(
            (exp as { cliente_nombre?: string } | null)?.cliente_nombre ?? "",
          ).trim();
          const expectedAdvisor = String(
            (asesor as { full_name?: string; email?: string } | null)?.full_name ||
              (asesor as { email?: string } | null)?.email ||
              "",
          ).trim();
          const slotKey =
            slotKeyFromInv ||
            buildPhysicalSheetRowKey({
              kind,
              bookingDate: date,
              logicalStartTime: time,
              sheetStartTime: expectedSheetTime || time,
              locationId,
              sheetId: tab.sheetId,
              rowNumber: targetRow,
            });
          // A es read-only (estructura Sheet). Solo B:D + O:U vía batchUpdate.
          await adapter.batchUpdateValues([
            {
              range: a1BdRange(tab.title, targetRow),
              values: [[expectedNss, expectedName, expectedAdvisor]],
            },
            {
              range: a1TechRange(tab.title, targetRow),
              values: [buildTechWriteRow({
                estado: "SINCRONIZADO",
                bookingId,
                expedienteId: String(payload.expediente_id ?? ""),
                slotKey,
                syncSource: "crm",
                syncUpdatedAt: new Date().toISOString(),
                syncVersion: 1,
              })],
            },
          ]);

          // Confirmación: A/E:N intactos; B:D + O:U reflejan la cita.
          const verify = await adapter.getValues(
            a1FullReadRange(tab.title, targetRow),
          );
          const vr = verify[0] ?? [];
          const aOk = String(vr[COL_INDEX.hora] ?? "") === horaSnapshot;
          const enOk = preserveEN.every((v, i) => String(vr[4 + i] ?? "") === v);
          const nssOk = String(vr[COL_INDEX.nss] ?? "").trim() === expectedNss;
          const nameOk =
            String(vr[COL_INDEX.nombre] ?? "").trim() === expectedName;
          const bookingOk =
            String(vr[COL_INDEX.bookingId] ?? "").trim() === bookingId;
          const sourceOk =
            String(vr[COL_INDEX.syncSource] ?? "").trim().toLowerCase() ===
              "crm";
          if (!aOk || !enOk || !nssOk || !nameOk || !bookingOk || !sourceOk) {
            if (priorId) await restorePriorSheetRow(priorId);
            await supabase.rpc("agenda_sheet_mark_outbox", {
              p_id: ev.id,
              p_status: "failed",
              p_error: !aOk
                ? "write_verify_failed:col_a_mutated"
                : !enOk
                ? "write_verify_failed:en_mutated"
                : "write_verify_failed",
            });
            failed++;
            continue;
          }

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
          await supabase.rpc("agenda_sheet_inventory_mark_linked", {
            p_booking_id: bookingId,
            p_sheet_row: targetRow,
          });

          await supabase.rpc("agenda_sheet_mark_outbox", {
            p_id: ev.id,
            p_status: "done",
          });
          done++;
          continue;
        }

        // booking_created ya tiene link (reintento idempotente)
        if (ev.event_type === "booking_created" && link) {
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
        const failPayload = (ev.payload ?? {}) as Record<string, unknown>;
        const priorFail = String(
          failPayload.prior_cancelled_booking_id ?? "",
        ).trim();
        if (ev.event_type === "booking_created" && priorFail) {
          await restorePriorSheetRow(priorFail);
        }
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
