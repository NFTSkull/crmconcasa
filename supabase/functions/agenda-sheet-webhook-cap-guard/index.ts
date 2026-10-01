// P213 — hard-cap delante del webhook Sheets → CRM.
// Relee la sección física completa antes de procesar una entrada manual nueva.
// Biométricos Monterrey/Apodaca: máximo 15 entre CRM + manuales.
// Si una entrada nueva sería la #16, limpia SOLO B:D + O:U; A y E:N se preservan.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  DEFAULT_SPREADSHEET_ID,
  parseSection,
  parseTabDate,
  timingSafeEqual,
} from "https://raw.githubusercontent.com/NFTSkull/crmconcasa/f9ce39f29ad074b1c9e6991f33e76b49f463e7f2/supabase/functions/_shared/agenda-sheets/parsers.ts";
import {
  COL_INDEX,
  a1BdRange,
  a1FullReadRange,
  a1TechRange,
} from "https://raw.githubusercontent.com/NFTSkull/crmconcasa/f9ce39f29ad074b1c9e6991f33e76b49f463e7f2/supabase/functions/_shared/agenda-sheets/tech-columns.ts";
import {
  createGoogleSheetsAdapter,
  type SheetsAdapter,
} from "https://raw.githubusercontent.com/NFTSkull/crmconcasa/f9ce39f29ad074b1c9e6991f33e76b49f463e7f2/supabase/functions/_shared/agenda-sheets/google.ts";
import {
  buildInventoryUpsertRows,
  type InventoryUpsertRow,
} from "https://raw.githubusercontent.com/NFTSkull/crmconcasa/b64663f9026816c63db5c69c7d9e6dfad1bc435a/supabase/functions/_shared/agenda-sheets/inventory-from-grid.ts";
import type { AgendaSheetTimeAlias } from "https://raw.githubusercontent.com/NFTSkull/crmconcasa/f9ce39f29ad074b1c9e6991f33e76b49f463e7f2/supabase/functions/_shared/agenda-sheets/time-aliases.ts";

type WebhookBody = {
  spreadsheetId?: string;
  sheetId?: number;
  sheetTitle?: string;
  rowNumber?: number;
  source?: string;
  idempotencyKey?: string;
  editedAt?: string;
};

type InventoryRowState = {
  status?: string | null;
  booking_id?: string | null;
  visible_nss?: string | null;
  visible_name?: string | null;
  visible_advisor?: string | null;
  kind?: string | null;
  location_id?: string | null;
  booking_date?: string | null;
};

const MAX_BODY = 8_192;
const PINNED_CORE = "agenda-sheet-webhook-core";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function rowHasVisibleManualData(row: ReadonlyArray<unknown>): boolean {
  return Boolean(
    String(row[COL_INDEX.nss] ?? "").trim() ||
      String(row[COL_INDEX.nombre] ?? "").trim() ||
      String(row[COL_INDEX.asesor] ?? "").trim()
  );
}

type MonterreySharedSection = "firmas" | "inscripcion" | "notificacion" | null;

function normalizeSheetLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inspectMonterreySharedPool(
  grid: ReadonlyArray<ReadonlyArray<unknown>>,
  targetRowNumber: number,
): { physicalTotal: number; targetInPool: boolean } {
  let section: MonterreySharedSection = null;
  let physicalTotal = 0;
  let targetInPool = false;

  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const a = normalizeSheetLabel(row[COL_INDEX.hora]);

    if (a === "MONTERREY FIRMAS") {
      section = "firmas";
      continue;
    }
    if (a === "MONTERREY INSCRIPCION") {
      section = "inscripcion";
      continue;
    }
    if (a.startsWith("NOTIFICACIONES CRM")) {
      section = "notificacion";
      continue;
    }
    if (
      a.startsWith("APODACA ") ||
      a.includes("BIOMETRICOS") ||
      /^LEO\b/.test(a)
    ) {
      section = null;
      continue;
    }
    if (!section || a === "HORA") continue;

    const isClock = /^\d{1,2}:\d{2}/.test(a);
    const isNotificationRow = /^NOTIFICACION\b/.test(a);
    const isPoolSlot =
      (section === "firmas" && isClock) ||
      (section === "inscripcion" && isClock && /^11:00/.test(a)) ||
      (section === "notificacion" && (isClock || isNotificationRow));

    if (!isPoolSlot) continue;
    if (i + 1 === targetRowNumber) targetInPool = true;
    if (rowHasVisibleManualData(row)) physicalTotal += 1;
  }

  return { physicalTotal, targetInPool };
}

async function upsertMonterreySharedSnapshot(
  supabase: ReturnType<typeof createClient>,
  input: {
    organizationId: string;
    bookingDate: string;
    physicalOccupancy: number;
    source: string;
  },
): Promise<void> {
  const { error } = await supabase.rpc("agenda_mty_shared_pool_snapshot_upsert", {
    p_organization_id: input.organizationId,
    p_booking_date: input.bookingDate,
    p_physical_occupancy: input.physicalOccupancy,
    p_source: input.source,
  });
  if (error) {
    throw new Error(`shared_pool_snapshot_upsert:${error.message}`);
  }
}

/**
 * LEO / HACER PAGARÉS es un bloque operativo manual ajeno a la agenda CRM.
 * Desde la fila cuyo A empieza con "LEO" hasta el siguiente encabezado real
 * (Monterrey/Apodaca + Firmas/Biométricos/Inscripción), el webhook debe ser no-op.
 */
function isLeoNonAgendaRow(
  grid: ReadonlyArray<ReadonlyArray<unknown>>,
  rowNumber: number,
): boolean {
  let inLeoBlock = false;
  const lastIndex = Math.min(Math.max(0, rowNumber), grid.length);

  for (let i = 0; i < lastIndex; i++) {
    const a = String(grid[i]?.[COL_INDEX.hora] ?? "").trim();
    if (/^LEO\b/i.test(a)) {
      inLeoBlock = true;
      continue;
    }
    if (inLeoBlock && parseSection(a)) {
      inLeoBlock = false;
    }
  }

  return inLeoBlock;
}

function priorInventoryConsumesPhysicalRow(row: InventoryRowState | null): boolean {
  if (!row) return false;
  const status = String(row.status ?? "");
  if (!["occupied_external", "conflict", "claimed", "linked"].includes(status)) {
    return false;
  }
  return Boolean(
    row.booking_id || row.visible_nss || row.visible_name || row.visible_advisor
  );
}

async function proxyCore(
  baseUrl: string,
  secret: string,
  rawBody: string,
): Promise<{ response: Response; text: string; parsed: Record<string, unknown> | null }> {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/functions/v1/${PINNED_CORE}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-concasa-webhook-secret": secret,
      },
      body: rawBody,
    },
  );
  const text = await response.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    const maybe = JSON.parse(text || "{}");
    if (maybe && typeof maybe === "object" && !Array.isArray(maybe)) {
      parsed = maybe as Record<string, unknown>;
    }
  } catch {
    parsed = null;
  }
  return { response, text, parsed };
}

async function clearRejectedRow(
  adapter: SheetsAdapter,
  sheetTitle: string,
  sheetRow: number,
): Promise<boolean> {
  await adapter.batchClear([
    a1BdRange(sheetTitle, sheetRow),
    a1TechRange(sheetTitle, sheetRow),
  ]);
  const verify = await adapter.getValues(a1FullReadRange(sheetTitle, sheetRow));
  const row = verify[0] ?? [];
  const bcdEmpty = [COL_INDEX.nss, COL_INDEX.nombre, COL_INDEX.asesor]
    .every((idx) => !String(row[idx] ?? "").trim());
  const techEmpty = [14, 15, 16, 17, 18, 19, 20]
    .every((idx) => !String(row[idx] ?? "").trim());
  return bcdEmpty && techEmpty;
}

async function releaseRejectedInventory(
  supabase: ReturnType<typeof createClient>,
  input: {
    organizationId: string;
    spreadsheetId: string;
    sheetId: number;
    sheetRow: number;
    bookingDate: string;
    kind: string;
    locationId: string;
  },
): Promise<void> {
  const { error } = await supabase.rpc("agenda_sheet_release_rejected_manual_row", {
    p_organization_id: input.organizationId,
    p_spreadsheet_id: input.spreadsheetId,
    p_sheet_id: input.sheetId,
    p_sheet_row: input.sheetRow,
    p_booking_date: input.bookingDate,
    p_kind: input.kind,
    p_location_id: input.locationId,
  });
  if (error) throw new Error(`release_rejected_inventory:${error.message}`);
}

async function logRejection(
  supabase: ReturnType<typeof createClient>,
  input: {
    organizationId: string;
    spreadsheetId: string;
    sheetId: number;
    sheetTitle: string;
    sheetRow: number;
    bookingDate: string;
    locationId: string;
    reason: string;
    occupancy?: number | null;
    capacity?: number | null;
  },
): Promise<void> {
  try {
    await supabase.from("action_log").insert({
      organization_id: input.organizationId,
      actor_id: null,
      action: "manual_daily_capacity_rejected",
      entity_type: "agenda_sheet_slot_inventory",
      entity_id: null,
      payload: {
        code: "MANUAL_DAILY_CAP_REJECTED",
        reason: input.reason,
        spreadsheet_id: input.spreadsheetId,
        sheet_id: input.sheetId,
        sheet_title: input.sheetTitle,
        sheet_row: input.sheetRow,
        booking_date: input.bookingDate,
        kind: "biometricos",
        location_id: input.locationId,
        occupancy: input.occupancy ?? null,
        capacity: input.capacity ?? null,
      },
    });
  } catch {
    // auditoría best-effort; nunca reabre una fila rechazada.
  }
}

async function failClosedNewManual(
  adapter: SheetsAdapter,
  supabase: ReturnType<typeof createClient>,
  input: {
    organizationId: string;
    spreadsheetId: string;
    sheetId: number;
    sheetTitle: string;
    sheetRow: number;
    bookingDate: string;
    kind: string;
    locationId: string;
    reason: string;
    occupancy?: number | null;
    capacity?: number | null;
    status?: number;
    message?: string;
  },
): Promise<Response> {
  let cleared = false;
  try {
    cleared = await clearRejectedRow(adapter, input.sheetTitle, input.sheetRow);
  } catch (e) {
    console.error("agenda-sheet-webhook-cap-guard clear failed", String(e));
  }

  if (!cleared) {
    // Fail-safe: no liberar inventario si Google no confirmó la limpieza.
    await logRejection(supabase, { ...input, reason: `${input.reason}:clear_failed` });
    return json(503, {
      ok: false,
      code: "daily_capacity_reject_clear_failed",
      message:
        "No fue posible validar/liberar la fila. No se creó ninguna cita; vuelve a intentar después de revisar la hoja.",
    });
  }

  try {
    await releaseRejectedInventory(supabase, input);
  } catch (e) {
    console.error("agenda-sheet-webhook-cap-guard release failed", String(e));
    // La fila física ya quedó vacía. Inventario conservador puede bloquear de más,
    // pero nunca habilita sobrecupo.
  }
  await logRejection(supabase, input);

  return json(input.status ?? 409, {
    ok: false,
    code: "daily_capacity_full",
    message:
      input.message ??
      `El cupo diario de biométricos ${input.locationId === "apodaca" ? "Apodaca" : "Monterrey"} está completo (máximo 15 personas). La fila no fue agregada.`,
    capacity: input.capacity ?? 15,
    occupancy: input.occupancy ?? null,
    row_cleared: true,
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return json(405, { code: "method_not_allowed", message: "Solo POST" });
    }
    if (Deno.env.get("GOOGLE_SHEETS_SYNC_ENABLED") === "false") {
      return json(503, { code: "sync_disabled", message: "Integración desactivada" });
    }

    const secret = Deno.env.get("GOOGLE_SHEETS_WEBHOOK_SECRET") ?? "";
    const hdr = req.headers.get("x-concasa-webhook-secret") ?? "";
    if (!secret || !timingSafeEqual(hdr, secret)) {
      return json(401, { code: "unauthorized", message: "Secreto inválido" });
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY) {
      return json(413, { code: "payload_too_large", message: "Body demasiado grande" });
    }

    let body: WebhookBody;
    try {
      body = JSON.parse(raw) as WebhookBody;
    } catch {
      return json(400, { code: "invalid_json", message: "JSON inválido" });
    }

    const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const organizationId = Deno.env.get("GOOGLE_SHEETS_ORGANIZATION_ID") ?? "";
    const expectedSpreadsheet =
      Deno.env.get("GOOGLE_SHEETS_SPREADSHEET_ID") ?? DEFAULT_SPREADSHEET_ID;

    // Casos que no son una edición manual de fila: conservar core exacto.
    if (
      !baseUrl ||
      !serviceKey ||
      !organizationId ||
      body.spreadsheetId !== expectedSpreadsheet ||
      typeof body.sheetId !== "number" ||
      !Number.isFinite(body.sheetId) ||
      typeof body.rowNumber !== "number" ||
      body.rowNumber < 1 ||
      !body.sheetTitle
    ) {
      const core = await proxyCore(baseUrl, secret, raw);
      return new Response(core.text, {
        status: core.response.status,
        headers: { "Content-Type": core.response.headers.get("content-type") ?? "application/json" },
      });
    }

    const year = Number(
      (Deno.env.get("GOOGLE_SHEETS_YEAR") ?? "2026").replace(/\D/g, "") || "2026",
    );
    const bookingDate = parseTabDate(body.sheetTitle, year);
    if (!bookingDate) {
      const core = await proxyCore(baseUrl, secret, raw);
      return new Response(core.text, {
        status: core.response.status,
        headers: { "Content-Type": core.response.headers.get("content-type") ?? "application/json" },
      });
    }

    const googleEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL") ?? "";
    const googlePk = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "";
    if (!googleEmail || !googlePk) {
      return json(500, { code: "missing_google_creds", message: "Credenciales no configuradas" });
    }

    const supabase = createClient(baseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adapter = await createGoogleSheetsAdapter({
      spreadsheetId: expectedSpreadsheet,
      serviceAccountEmail: googleEmail,
      privateKeyPem: googlePk,
    });

    const titleEsc = `'${String(body.sheetTitle).replace(/'/g, "''")}'`;
    const grid = await adapter.getValues(`${titleEsc}!A1:U200`);
    const sharedPool = inspectMonterreySharedPool(grid, body.rowNumber);

    const { data: priorSharedRaw } = await supabase
      .from("agenda_mty_shared_pool_snapshot")
      .select("physical_occupancy")
      .eq("organization_id", organizationId)
      .eq("booking_date", bookingDate)
      .maybeSingle();
    const priorSharedCount =
      priorSharedRaw &&
      Number.isFinite(Number((priorSharedRaw as { physical_occupancy?: number }).physical_occupancy))
        ? Number((priorSharedRaw as { physical_occupancy?: number }).physical_occupancy)
        : null;

    const targetPhysicalRow = grid[body.rowNumber - 1] ?? [];
    const targetBookingCell = String(
      targetPhysicalRow[COL_INDEX.bookingId] ?? "",
    ).trim();
    const targetVisible = rowHasVisibleManualData(targetPhysicalRow);

    // El webhook relee A:U completo: mantener un snapshot exacto del pool físico
    // Monterrey Firmas + Inscripción + Notificación. Esto hace que el trigger DB
    // pueda bloquear la persona #16 aun cuando el Drive use bloques distintos.
    if (
      body.source !== "crm" &&
      sharedPool.targetInPool &&
      !targetBookingCell &&
      targetVisible &&
      sharedPool.physicalTotal > 15 &&
      (priorSharedCount == null || sharedPool.physicalTotal > priorSharedCount)
    ) {
      const cleared = await clearRejectedRow(
        adapter,
        body.sheetTitle,
        body.rowNumber,
      );
      if (!cleared) {
        return json(503, {
          ok: false,
          code: "shared_daily_capacity_reject_clear_failed",
          message:
            "El cupo combinado ya está completo y no fue posible limpiar la fila nueva. Revisa la hoja antes de continuar.",
        });
      }

      await upsertMonterreySharedSnapshot(supabase, {
        organizationId,
        bookingDate,
        physicalOccupancy: Math.max(0, sharedPool.physicalTotal - 1),
        source: "webhook_shared_rejected",
      });

      try {
        await supabase.from("action_log").insert({
          organization_id: organizationId,
          actor_id: null,
          action: "manual_shared_daily_capacity_rejected",
          entity_type: "agenda_sheet_slot_inventory",
          entity_id: null,
          payload: {
            code: "SHARED_MTY_DAILY_CAP_REJECTED",
            sheet_title: body.sheetTitle,
            sheet_id: body.sheetId,
            sheet_row: body.rowNumber,
            booking_date: bookingDate,
            physical_occupancy_attempted: sharedPool.physicalTotal,
            capacity: 15,
          },
        });
      } catch {
        // auditoría best-effort
      }

      return json(409, {
        ok: false,
        code: "shared_daily_capacity_full",
        message:
          "Firmas + Inscripción + Notificación ya completaron los 15 lugares de Monterrey. La fila nueva fue retirada.",
        capacity: 15,
        occupancy: sharedPool.physicalTotal - 1,
        row_cleared: true,
      });
    }

    await upsertMonterreySharedSnapshot(supabase, {
      organizationId,
      bookingDate,
      physicalOccupancy: sharedPool.physicalTotal,
      source: body.source === "crm" ? "webhook_crm" : "webhook_sheet",
    });

    // Escrituras originadas por CRM solo refrescan el snapshot compartido y
    // continúan por el core exacto; jamás se limpian como captura manual.
    if (body.source === "crm") {
      const core = await proxyCore(baseUrl, secret, raw);
      return new Response(core.text, {
        status: core.response.status,
        headers: { "Content-Type": core.response.headers.get("content-type") ?? "application/json" },
      });
    }

    // LEO / HACER PAGARÉS es captura manual independiente. Nunca enviarla al
    // core, nunca limpiarla y nunca incorporarla al inventario/cupo CRM.
    if (isLeoNonAgendaRow(grid, body.rowNumber)) {
      return json(200, {
        ok: true,
        ignored: true,
        code: "non_agenda_leo",
        message: "LEO / HACER PAGARÉS: captura manual guardada; CRM no modifica esta fila.",
      });
    }

    // Booking ya sincronizado: nunca interferir con sus columnas/operación.
    if (targetBookingCell) {
      const core = await proxyCore(baseUrl, secret, raw);
      return new Response(core.text, {
        status: core.response.status,
        headers: { "Content-Type": core.response.headers.get("content-type") ?? "application/json" },
      });
    }

    // Entrada manual sin hora: no puede consumir cupo y no debe quedar flotando.
    const horaVisible = String(targetPhysicalRow[COL_INDEX.hora] ?? "").trim();
    if (!horaVisible && targetVisible) {
      const cleared = await clearRejectedRow(adapter, body.sheetTitle, body.rowNumber);
      return json(cleared ? 409 : 503, {
        ok: false,
        code: "manual_entry_without_slot",
        message: cleared
          ? "Captura la cita en una fila que tenga horario asignado. La fila inválida fue limpiada."
          : "No fue posible limpiar la fila sin horario; no se creó ninguna cita.",
        row_cleared: cleared,
      });
    }

    let aliases: AgendaSheetTimeAlias[] = [];
    const { data: aliasJson } = await supabase.rpc("agenda_sheet_list_time_aliases", {
      p_organization_id: organizationId,
    });
    if (Array.isArray(aliasJson)) aliases = aliasJson as AgendaSheetTimeAlias[];

    const parsed = buildInventoryUpsertRows({
      organizationId,
      spreadsheetId: expectedSpreadsheet,
      sheetId: body.sheetId,
      sheetTitle: body.sheetTitle,
      bookingDate,
      grid: grid.map((r) => (r ?? []).map((c) => String(c ?? ""))),
      timeAliases: aliases,
    });
    const target = parsed.rows.find(
      (r) => r.sheet_row === body.rowNumber && r.status !== "disabled",
    );

    // Hard-cap Biométricos en Monterrey y Apodaca. Todo lo demás conserva core.
    if (
      !target ||
      target.kind !== "biometricos" ||
      !["monterrey", "apodaca"].includes(target.location_id)
    ) {
      const core = await proxyCore(baseUrl, secret, raw);
      return new Response(core.text, {
        status: core.response.status,
        headers: { "Content-Type": core.response.headers.get("content-type") ?? "application/json" },
      });
    }

    const { data: priorInvRaw } = await supabase
      .from("agenda_sheet_slot_inventory")
      .select("status,booking_id,visible_nss,visible_name,visible_advisor,kind,location_id,booking_date")
      .eq("organization_id", organizationId)
      .eq("spreadsheet_id", expectedSpreadsheet)
      .eq("sheet_id", body.sheetId)
      .eq("sheet_row", body.rowNumber)
      .maybeSingle();
    const priorInv = (priorInvRaw ?? null) as InventoryRowState | null;
    const targetWasOccupied = priorInventoryConsumesPhysicalRow(priorInv);

    // Refrescar todos los cupos físicos actuales EXCEPTO la fila que se está intentando
    // agregar. Así la candidata no se cuenta a sí misma antes de agenda_sheet_book_by_nss.
    const scopeRows = parsed.rows.filter(
      (r) => r.kind === "biometricos" && r.location_id === target.location_id,
    );
    const refreshRows: InventoryUpsertRow[] = scopeRows.filter(
      (r) => r.sheet_row !== body.rowNumber,
    );

    for (let i = 0; i < refreshRows.length; i += 200) {
      const chunk = refreshRows.slice(i, i + 200);
      if (!chunk.length) continue;
      const { error } = await supabase.rpc("agenda_sheet_inventory_upsert_batch", {
        p_rows: chunk,
      });
      if (error) {
        if (!targetWasOccupied && targetVisible) {
          return await failClosedNewManual(adapter, supabase, {
            organizationId,
            spreadsheetId: expectedSpreadsheet,
            sheetId: body.sheetId,
            sheetTitle: body.sheetTitle,
            sheetRow: body.rowNumber,
            bookingDate,
            kind: target.kind,
            locationId: target.location_id,
            reason: "inventory_refresh_failed",
            status: 503,
            message:
              "No fue posible validar el cupo real. Por seguridad la fila nueva no fue agregada.",
          });
        }
        throw new Error(`inventory_refresh_failed:${error.message}`);
      }
    }

    const seenRows = scopeRows.map((r) => r.sheet_row);
    const { error: pruneErr } = await supabase.rpc("agenda_sheet_inventory_prune_scope", {
      p_organization_id: organizationId,
      p_spreadsheet_id: expectedSpreadsheet,
      p_sheet_id: body.sheetId,
      p_booking_date: bookingDate,
      p_kind: "biometricos",
      p_location_id: target.location_id,
      p_seen_rows: seenRows,
    });
    if (pruneErr && !targetWasOccupied && targetVisible) {
      return await failClosedNewManual(adapter, supabase, {
        organizationId,
        spreadsheetId: expectedSpreadsheet,
        sheetId: body.sheetId,
        sheetTitle: body.sheetTitle,
        sheetRow: body.rowNumber,
        bookingDate,
        kind: target.kind,
        locationId: target.location_id,
        reason: "inventory_prune_failed",
        status: 503,
        message:
          "No fue posible validar el cupo real. Por seguridad la fila nueva no fue agregada.",
      });
    }

    const [{ data: capData }, { data: remainingData }, { data: occBeforeData }] =
      await Promise.all([
        supabase.rpc("agenda_daily_capacity", {
          p_org: organizationId,
          p_kind: "biometricos",
          p_date: bookingDate,
          p_location: target.location_id,
        }),
        supabase.rpc("agenda_daily_remaining", {
          p_org: organizationId,
          p_kind: "biometricos",
          p_date: bookingDate,
          p_location: target.location_id,
        }),
        supabase.rpc("agenda_daily_active_occupancy", {
          p_org: organizationId,
          p_kind: "biometricos",
          p_date: bookingDate,
          p_location: target.location_id,
        }),
      ]);

    const capacity = Number(capData ?? 15);
    const remaining = Number(remainingData ?? 0);
    const occupancyBefore = Number(occBeforeData ?? Math.max(0, capacity - remaining));

    // Entrada NUEVA con el día ya completo: rechazo antes de invocar el core.
    if (!targetWasOccupied && targetVisible && remaining < 1) {
      return await failClosedNewManual(adapter, supabase, {
        organizationId,
        spreadsheetId: expectedSpreadsheet,
        sheetId: body.sheetId,
        sheetTitle: body.sheetTitle,
        sheetRow: body.rowNumber,
        bookingDate,
        kind: target.kind,
        locationId: target.location_id,
        reason: "pre_core_daily_capacity_full",
        occupancy: occupancyBefore,
        capacity,
      });
    }

    const core = await proxyCore(baseUrl, secret, raw);

    // Para una fila nueva, certificar postcondición después del core. Esto cubre la
    // carrera CRM↔Sheet entre el refresh y el write del webhook.
    if (!targetWasOccupied && targetVisible) {
      const [{ data: targetAfterRaw }, { data: occAfterRaw }] = await Promise.all([
        supabase
          .from("agenda_sheet_slot_inventory")
          .select("status,booking_id,visible_nss,visible_name,visible_advisor,kind,location_id,booking_date")
          .eq("organization_id", organizationId)
          .eq("spreadsheet_id", expectedSpreadsheet)
          .eq("sheet_id", body.sheetId)
          .eq("sheet_row", body.rowNumber)
          .maybeSingle(),
        supabase.rpc("agenda_daily_active_occupancy", {
          p_org: organizationId,
          p_kind: "biometricos",
          p_date: bookingDate,
          p_location: target.location_id,
        }),
      ]);
      const targetAfter = (targetAfterRaw ?? null) as InventoryRowState | null;
      const occupancyAfter = Number(occAfterRaw ?? 0);
      const coreCode = String(core.parsed?.code ?? "");
      const coreOccupiedManual = core.parsed?.occupied_manual === true;
      const targetHasBooking = Boolean(targetAfter?.booking_id);
      const targetExternal = ["occupied_external", "conflict"].includes(
        String(targetAfter?.status ?? ""),
      );

      const terminalAttemptError =
        core.response.status >= 400 &&
        ["slot_taken", "duplicate_booking", "daily_capacity_full"].includes(coreCode);

      if (
        !targetHasBooking &&
        (occupancyAfter > capacity || terminalAttemptError)
      ) {
        return await failClosedNewManual(adapter, supabase, {
          organizationId,
          spreadsheetId: expectedSpreadsheet,
          sheetId: body.sheetId,
          sheetTitle: body.sheetTitle,
          sheetRow: body.rowNumber,
          bookingDate,
          kind: target.kind,
          locationId: target.location_id,
          reason: terminalAttemptError
            ? `core_rejected_${coreCode}`
            : "post_core_overcapacity",
          occupancy: occupancyAfter,
          capacity,
        });
      }

      // Si el core decidió conservar una ocupación manual válida y seguimos <=15,
      // se deja exactamente como estaba diseñado.
      if (coreOccupiedManual && targetExternal && occupancyAfter <= capacity) {
        // no-op explícito
      }

      if (targetHasBooking && occupancyAfter > capacity) {
        // Esta postcondición no debe ser alcanzable: refresh físico + lock diario del
        // booking impiden que una nueva cita CRM sea la #16. No tocar una cita real
        // automáticamente; registrar P0 para investigación conservadora.
        console.error("P213_HARD_CAP_POSTCONDITION_BOOKING_OVERFLOW", {
          booking_date: bookingDate,
          sheet_id: body.sheetId,
          sheet_row: body.rowNumber,
          booking_id: targetAfter?.booking_id,
          occupancy: occupancyAfter,
          capacity,
        });
      }
    }

    return new Response(core.text, {
      status: core.response.status,
      headers: { "Content-Type": core.response.headers.get("content-type") ?? "application/json" },
    });
  } catch (e) {
    console.error("agenda-sheet-webhook-cap-guard error", String(e));
    return json(500, {
      ok: false,
      code: "cap_guard_internal_error",
      message:
        "No fue posible validar el cupo real. No se creó ninguna cita desde esta operación.",
    });
  }
});
