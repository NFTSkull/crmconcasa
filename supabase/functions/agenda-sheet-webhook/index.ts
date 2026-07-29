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
  a1FullReadRange,
  a1TechRange,
  a1VisibleRange,
  assertTechColumnsWritable,
  buildTechWriteRow,
} from "../_shared/agenda-sheets/tech-columns.ts";
import {
  createGoogleSheetsAdapter,
  type SheetsAdapter,
} from "../_shared/agenda-sheets/google.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    if (bookingIdCell) {
      return jsonOk({
        ignored: true,
        reason: "already_synced",
        booking_id: bookingIdCell,
      });
    }

    const slotTime = parseTime(horaRaw);
    if (!slotTime) {
      return jsonError(400, "invalid_time", "Hora inválida en fila");
    }
    const nss = normalizeNss(nssRaw);
    if (!nss) {
      // Borrado de celdas: no cancelar
      if (!String(nssRaw).trim()) {
        return jsonOk({
          ignored: true,
          reason: "empty_nss_no_cancel",
          message:
            "Para cancelar la cita utiliza ConCasa > Cancelar cita seleccionada.",
        });
      }
      return jsonError(
        400,
        "invalid_nss",
        "El NSS no corresponde a un expediente disponible para esta cita.",
      );
    }

    // Inferir sección buscando hacia arriba (Edge lee bloque A1:A{row})
    const titleEsc = `'${String(body.sheetTitle).replace(/'/g, "''")}'`;
    const headerRange = `${titleEsc}!A1:A${body.rowNumber}`;
    const colA = await adapter.getValues(headerRange);
    let section: { sede: string; kind: string } | null = null;
    let ordinal = 0;
    for (let i = 0; i < colA.length; i++) {
      const cell = String(colA[i]?.[0] ?? "");
      const s = parseSection(cell);
      if (s) {
        section = s;
        ordinal = 0;
        continue;
      }
      if (!section) continue;
      const t = parseTime(cell);
      if (!t) continue;
      if (t === slotTime) ordinal += 1;
      if (i + 1 === body.rowNumber) break;
    }
    if (!section || ordinal < 1) {
      return jsonError(400, "section_not_found", "Fila fuera de bloque de citas");
    }

    const scheduledAt = `${sheetDate}T${slotTime}:00-06:00`;
    const orgId = Deno.env.get("GOOGLE_SHEETS_ORGANIZATION_ID") ?? "";
    if (!orgId) {
      return jsonError(500, "missing_org", "Organization no configurada");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data, error } = await supabase.rpc("agenda_sheet_book_by_nss", {
      p_organization_id: orgId,
      p_spreadsheet_id: expectedSs,
      p_sheet_id: body.sheetId,
      p_sheet_title: body.sheetTitle,
      p_sheet_date: sheetDate,
      p_row_number: body.rowNumber,
      p_location_id: section.sede,
      p_kind: section.kind,
      p_slot_time: slotTime,
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

    // Solo A:D (hora/NSS/nombre/asesor). Nunca E:N ni H:N.
    const nowIso = new Date().toISOString();
    if (decision.mode === "write") {
      await adapter.updateValues(
        a1VisibleRange(String(body.sheetTitle), body.rowNumber),
        [[
          horaRaw,
          String(result.nss ?? nss),
          String(result.cliente_nombre ?? ""),
          String(result.asesor_nombre ?? ""),
        ]],
      );
      await adapter.updateValues(
        a1TechRange(String(body.sheetTitle), body.rowNumber),
        [buildTechWriteRow({
          estado: "SINCRONIZADO",
          bookingId,
          expedienteId: String(result.expediente_id ?? ""),
          slotKey: `${section.kind}|${sheetDate}|${slotTime}|${section.sede}|${ordinal}`,
          syncSource: "sheets",
          syncUpdatedAt: nowIso,
          syncVersion: 1,
        })],
      );
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
