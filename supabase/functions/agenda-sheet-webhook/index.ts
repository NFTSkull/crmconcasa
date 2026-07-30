/**
 * Edge Function: agenda-sheet-webhook
 * Sheets → CRM. Valida secreto, relee fila, invoca agenda_sheet_book_by_nss.
 * No expone service_role al navegador. No escribe la hoja real en esta fase local
 * salvo cuando se despliegue con GOOGLE_SHEETS_SYNC_ENABLED=true.
 */
import {
  DEFAULT_SPREADSHEET_ID,
  jsonError,
  jsonOk,
  normalizeNss,
  parseSection,
  parseTabDate,
  parseTime,
  timingSafeEqual,
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
  createGoogleSheetsAdapter,
  type SheetsAdapter,
} from "../_shared/agenda-sheets/google.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  type AgendaSheetTimeAlias,
  buildPhysicalSheetRowKey,
  resolveLogicalStartTime,
} from "../_shared/agenda-sheets/time-aliases.ts";

type WebhookBody = {
  spreadsheetId?: string;
  sheetId?: number;
  sheetTitle?: string;
  rowNumber?: number;
  source?: string;
  idempotencyKey?: string;
};

const MAX_BODY = 8_192;

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonError(405, "method_not_allowed", "Solo POST");
    }
    if (Deno.env.get("GOOGLE_SHEETS_SYNC_ENABLED") === "false") {
      return jsonError(503, "sync_disabled", "Integración desactivada");
    }

    const secret = Deno.env.get("GOOGLE_SHEETS_WEBHOOK_SECRET") ?? "";
    const hdr = req.headers.get("x-concasa-webhook-secret") ?? "";
    if (!secret || !timingSafeEqual(hdr, secret)) {
      return jsonError(401, "unauthorized", "Secreto inválido");
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY) {
      return jsonError(413, "payload_too_large", "Body demasiado grande");
    }
    let body: WebhookBody;
    try {
      body = JSON.parse(raw) as WebhookBody;
    } catch {
      return jsonError(400, "invalid_json", "JSON inválido");
    }

    const expectedSs =
      Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? DEFAULT_SPREADSHEET_ID;
    if (!body.spreadsheetId || body.spreadsheetId !== expectedSs) {
      return jsonError(400, "spreadsheet_mismatch", "Spreadsheet incorrecto");
    }
    if (
      typeof body.sheetId !== "number" ||
      !Number.isFinite(body.sheetId) ||
      typeof body.rowNumber !== "number" ||
      body.rowNumber < 1 ||
      !body.sheetTitle
    ) {
      return jsonError(400, "invalid_row", "Fila o hoja inválida");
    }
    if (body.source === "crm") {
      return jsonOk({ ignored: true, reason: "crm_echo" });
    }

    const year = Number(
      (Deno.env.get("GOOGLE_SHEETS_YEAR") ?? "2026").replace(/\D/g, "") || "2026",
    );
    const sheetDate = parseTabDate(body.sheetTitle, year);
    if (!sheetDate) {
      return jsonError(400, "unrecognized_tab", "Pestaña no reconocida");
    }

    const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
    const pk = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "";
    if (!email || !pk) {
      return jsonError(500, "missing_google_creds", "Credenciales no configuradas");
    }

    const adapter: SheetsAdapter = await createGoogleSheetsAdapter({
      spreadsheetId: expectedSs,
      serviceAccountEmail: email,
      privateKeyPem: pk,
    });

    // Releer fila A:U (visibles A:D + preservar E:N + técnicas O:U)
    const range = a1FullReadRange(String(body.sheetTitle), body.rowNumber);
    const values = await adapter.getValues(range);
    const row = values[0] ?? [];
    const horaRaw = String(row[COL_INDEX.hora] ?? "");
    const nssRaw = String(row[COL_INDEX.nss] ?? "");
    const bookingIdCell = String(row[COL_INDEX.bookingId] ?? "").trim(); // P
    const nameCellEarly = String(row[COL_INDEX.nombre] ?? "").trim();
    const advisorCellEarly = String(row[COL_INDEX.asesor] ?? "").trim();

    if (bookingIdCell) {
      // CASO B: si A cambió respecto al inventario linked, registrar conflicto (no mutar booking).
      const slotTimeProbe = parseTime(horaRaw);
      const orgProbe = Deno.env.get("GOOGLE_SHEETS_ORGANIZATION_ID") ?? "";
      if (slotTimeProbe && orgProbe) {
        const sbProbe = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data: prevInv } = await sbProbe
          .from("agenda_sheet_slot_inventory")
          .select("id,sheet_slot_time,slot_time,status,booking_id")
          .eq("spreadsheet_id", expectedSs)
          .eq("sheet_id", body.sheetId)
          .eq("sheet_row", body.rowNumber)
          .maybeSingle();
        const prev = prevInv as {
          id?: string;
          sheet_slot_time?: string | null;
          slot_time?: string | null;
          status?: string;
          booking_id?: string | null;
        } | null;
        const prevSheet = String(prev?.sheet_slot_time ?? prev?.slot_time ?? "")
          .slice(0, 5);
        if (prevSheet && prevSheet !== slotTimeProbe) {
          await sbProbe.from("action_log").insert({
            organization_id: orgProbe,
            actor_id: null,
            action: "occupied_slot_time_changed",
            entity_type: "agenda_sheet_slot_inventory",
            entity_id: prev?.id ?? bookingIdCell,
            payload: {
              code: "occupied_slot_time_changed",
              sheetId: body.sheetId,
              sheetTitle: body.sheetTitle,
              rowNumber: body.rowNumber,
              previousSheetTime: prevSheet,
              newSheetTime: slotTimeProbe,
              booking_id: bookingIdCell,
            },
          });
          return jsonOk({
            ok: true,
            conflict: "occupied_slot_time_changed",
            booking_id: bookingIdCell,
            previousSheetTime: prevSheet,
            newSheetTime: slotTimeProbe,
          });
        }
      }
      return jsonOk({
        ignored: true,
        reason: "already_synced",
        booking_id: bookingIdCell,
      });
    }

    // Fila con NSS/nombre/asesor sin booking_id: ocupación externa; A change → conflicto
    if ((nameCellEarly || advisorCellEarly || String(nssRaw).trim()) && bookingIdCell === "") {
      // continues to normal flow / empty-nss inventory path below
    }
    void nameCellEarly;
    void advisorCellEarly;

    const slotTime = parseTime(horaRaw);
    if (!slotTime) {
      // Encabezado/título en A: no procesar como slot
      if (parseSection(horaRaw) || !String(horaRaw).trim()) {
        return jsonOk({ ignored: true, reason: "not_a_slot_row" });
      }
      return jsonError(400, "invalid_time", "Hora inválida en fila");
    }

    const orgIdEarly = Deno.env.get("GOOGLE_SHEETS_ORGANIZATION_ID") ?? "";
    const supabaseEarly = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Inferir sección antes de NSS (necesario para reconcile de columna A)
    const titleEscEarly = `'${String(body.sheetTitle).replace(/'/g, "''")}'`;
    const headerRangeEarly = `${titleEscEarly}!A1:A${body.rowNumber}`;
    const colAEarly = await adapter.getValues(headerRangeEarly);
    let sectionEarly: { sede: string; kind: string } | null = null;
    let ordinalEarly = 0;
    for (let i = 0; i < colAEarly.length; i++) {
      const cell = String(colAEarly[i]?.[0] ?? "");
      const s = parseSection(cell);
      if (s) {
        sectionEarly = s;
        ordinalEarly = 0;
        continue;
      }
      if (!sectionEarly) continue;
      const t = parseTime(cell);
      if (!t) continue;
      if (t === slotTime) ordinalEarly += 1;
      if (i + 1 === body.rowNumber) break;
    }
    if (!sectionEarly || ordinalEarly < 1) {
      return jsonError(400, "section_not_found", "Fila fuera de bloque de citas");
    }

    const nss = normalizeNss(nssRaw);
    const nameCell = String(row[COL_INDEX.nombre] ?? "").trim();
    const advisorCell = String(row[COL_INDEX.asesor] ?? "").trim();
    const occupiedVisible = Boolean(nss || nameCell || advisorCell || bookingIdCell);

    // CASO B: fila ocupada/linked y cambia A → conflicto estable; no mutar bookings.
    if (bookingIdCell || (occupiedVisible && bookingIdCell)) {
      // bookingId already handled above as already_synced; reach here with visibles
    }
    if (occupiedVisible && !nss) {
      // has name/advisor without valid nss — treat as occupied sheet row
    }

    if (!nss) {
      if (!String(nssRaw).trim()) {
        // CASO A: fila vacía — reconciliar inventario inmediato por edición de A
        if (!orgIdEarly) {
          return jsonError(500, "missing_org", "Organization no configurada");
        }
        const { data: aliasRowsEmpty } = await supabaseEarly.rpc(
          "agenda_sheet_list_time_aliases",
          { p_organization_id: orgIdEarly },
        );
        const aliasesEmpty = (aliasRowsEmpty ?? []) as AgendaSheetTimeAlias[];
        const logicalEmpty = resolveLogicalStartTime({
          locationId: sectionEarly.sede,
          kind: sectionEarly.kind,
          sheetStartTime: slotTime,
          aliases: aliasesEmpty,
        });
        const physicalKey = buildPhysicalSheetRowKey({
          kind: sectionEarly.kind,
          bookingDate: sheetDate,
          logicalStartTime: logicalEmpty,
          sheetStartTime: slotTime,
          locationId: sectionEarly.sede,
          sheetId: body.sheetId,
          rowNumber: body.rowNumber,
        });

        // Si inventario previo linked/claimed con booking → conflicto, no mover cita
        const { data: prevInv } = await supabaseEarly
          .from("agenda_sheet_slot_inventory")
          .select("id,status,booking_id,sheet_slot_time,slot_time")
          .eq("spreadsheet_id", expectedSs)
          .eq("sheet_id", body.sheetId)
          .eq("sheet_row", body.rowNumber)
          .maybeSingle();
        const prev = prevInv as {
          id?: string;
          status?: string;
          booking_id?: string | null;
          sheet_slot_time?: string | null;
          slot_time?: string | null;
        } | null;
        if (
          prev &&
          (prev.status === "linked" || prev.status === "claimed") &&
          prev.booking_id
        ) {
          const prevSheet = String(prev.sheet_slot_time ?? prev.slot_time ?? "")
            .slice(0, 5);
          await supabaseEarly.from("action_log").insert({
            organization_id: orgIdEarly,
            actor_id: null,
            action: "occupied_slot_time_changed",
            entity_type: "agenda_sheet_slot_inventory",
            entity_id: prev.id!,
            payload: {
              code: "occupied_slot_time_changed",
              sheetId: body.sheetId,
              sheetTitle: body.sheetTitle,
              rowNumber: body.rowNumber,
              previousSheetTime: prevSheet,
              newSheetTime: slotTime,
              booking_id: prev.booking_id,
            },
          });
          return jsonOk({
            ok: true,
            conflict: "occupied_slot_time_changed",
            booking_id: prev.booking_id,
            previousSheetTime: prevSheet,
            newSheetTime: slotTime,
          });
        }

        const upsert = await supabaseEarly.rpc(
          "agenda_sheet_inventory_upsert_batch",
          {
            p_rows: [
              {
                organization_id: orgIdEarly,
                spreadsheet_id: expectedSs,
                sheet_id: body.sheetId,
                sheet_title: body.sheetTitle,
                booking_date: sheetDate,
                sheet_row: body.rowNumber,
                kind: sectionEarly.kind,
                location_id: sectionEarly.sede,
                slot_time: `${logicalEmpty}:00`,
                sheet_slot_time: `${slotTime}:00`,
                slot_key: physicalKey,
                status: "available",
                visible_nss: null,
                visible_name: null,
                visible_advisor: null,
                booking_id: null,
                expediente_id: null,
                occupancy_source: "reconciliation",
              },
            ],
          },
        );
        if (upsert.error) {
          return jsonError(
            500,
            "inventory_upsert_failed",
            String(upsert.error.message ?? "").slice(0, 200),
          );
        }
        return jsonOk({
          ok: true,
          inventory_reconciled: true,
          logicalStartTime: logicalEmpty,
          sheetStartTime: slotTime,
          slot_key: physicalKey,
        });
      }
      return jsonError(
        400,
        "invalid_nss",
        "El NSS no corresponde a un expediente disponible para esta cita.",
      );
    }

    const section = sectionEarly;
    const ordinal = ordinalEarly;

    const orgId = orgIdEarly;
    if (!orgId) {
      return jsonError(500, "missing_org", "Organization no configurada");
    }

    const supabase = supabaseEarly;

    // Alias horario many-to-one: p.ej. 11:00 físico → 10:00 lógico (sin mutar A).
    const { data: aliasRows } = await supabase.rpc("agenda_sheet_list_time_aliases", {
      p_organization_id: orgId,
    });
    const timeAliases = (aliasRows ?? []) as AgendaSheetTimeAlias[];
    const logicalSlotTime = resolveLogicalStartTime({
      locationId: section.sede,
      kind: section.kind,
      sheetStartTime: slotTime,
      aliases: timeAliases,
    });
    const scheduledAt = `${sheetDate}T${logicalSlotTime}:00-06:00`;

    const { data, error } = await supabase.rpc("agenda_sheet_book_by_nss", {
      p_organization_id: orgId,
      p_spreadsheet_id: expectedSs,
      p_sheet_id: body.sheetId,
      p_sheet_title: body.sheetTitle,
      p_sheet_date: sheetDate,
      p_row_number: body.rowNumber,
      p_location_id: section.sede,
      p_kind: section.kind,
      p_slot_time: logicalSlotTime,
      p_slot_ordinal: ordinal,
      p_nss: nss,
      p_scheduled_at: scheduledAt,
      p_idempotency_key: body.idempotencyKey ?? null,
    });

    if (error) {
      const msg = String(error.message ?? "");
      if (/ya fue reservado/i.test(msg)) {
        return jsonError(409, "slot_taken", "Este espacio ya fue reservado en el CRM.");
      }
      if (/NSS no corresponde|no corresponde a un expediente/i.test(msg)) {
        return jsonError(
          422,
          "nss_not_eligible",
          "El NSS no corresponde a un expediente disponible para esta cita.",
        );
      }
      if (/ya existe/i.test(msg)) {
        return jsonError(
          409,
          "duplicate_booking",
          "La cita ya existe en otra fila u horario.",
        );
      }
      return jsonError(
        422,
        "book_rejected",
        "No fue posible sincronizar. No se creó ninguna cita.",
      );
    }

    const result = data as Record<string, unknown>;
    const bookingId = String(result.booking_id ?? "");
    // Releer O:U justo antes de escribir (nunca A:N técnicos legacy / H:N)
    const fresh = await adapter.getValues(
      a1FullReadRange(String(body.sheetTitle), body.rowNumber),
    );
    const freshRow = fresh[0] ?? [];
    const decision = assertTechColumnsWritable({
      existingRowOrTech: freshRow,
      bookingId,
    });
    if (!decision.ok) {
      return jsonError(
        409,
        decision.reason === "other_booking" ? "tech_conflict_other_booking" : "tech_unexpected",
        decision.message,
      );
    }

    // Solo B:D + O:U. Columna A (hora física) es read-only.
    const nowIso = new Date().toISOString();
    if (decision.mode === "write") {
      const physicalSlotKey = buildPhysicalSheetRowKey({
        kind: section.kind,
        bookingDate: sheetDate,
        logicalStartTime: logicalSlotTime,
        sheetStartTime: slotTime,
        locationId: section.sede,
        sheetId: body.sheetId,
        rowNumber: body.rowNumber,
      });
      await adapter.batchUpdateValues([
        {
          range: a1BdRange(String(body.sheetTitle), body.rowNumber),
          values: [[
            String(result.nss ?? nss),
            String(result.cliente_nombre ?? ""),
            String(result.asesor_nombre ?? ""),
          ]],
        },
        {
          range: a1TechRange(String(body.sheetTitle), body.rowNumber),
          values: [buildTechWriteRow({
            estado: "SINCRONIZADO",
            bookingId,
            expedienteId: String(result.expediente_id ?? ""),
            slotKey: physicalSlotKey,
            syncSource: "sheets",
            syncUpdatedAt: nowIso,
            syncVersion: 1,
          })],
        },
      ]);
    }

    return jsonOk({
      booking_id: result.booking_id,
      expediente_id: result.expediente_id,
      nss: result.nss,
      sync_status: "SINCRONIZADO",
      tech_write: decision.mode,
    });
  } catch (e) {
    console.error("agenda-sheet-webhook error", String(e));
    return jsonError(
      500,
      "internal_error",
      "No fue posible sincronizar. No se creó ninguna cita.",
    );
  }
});
