/**
 * Dry-run LIVE de limpieza cancelación: lee A:U desde Google Sheets.
 * No modifica Sheet, outbox ni bookings.
 *
 * Uso:
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/agenda-cancel-clear-dry-run.ts
 *
 * Requiere lectura Sheets (ADC o GOOGLE_SERVICE_ACCOUNT_JSON).
 * Ubicación Cloud vía inventario solo para sheet_id/title/row; la clasificación
 * usa exclusivamente celdas live A:U.
 */
import { createSign } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  cancelClearBatchRanges,
  classifyCancelRowClearance,
  summarizeLiveRowAU,
  type CancelClearClassification,
} from "../src/domain/agenda-sheets/cancel-row-clearance";
import { a1FullReadRange } from "../src/domain/agenda-sheets/tech-columns";

const SPREADSHEET_ID = "1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA";

const TARGETS: Array<{
  label: string;
  bookingId: string;
  /** Hint si inventario Cloud no tiene fila. */
  hintTitle?: string;
  hintRow?: number;
}> = [
  {
    label: "José Osvaldo (cancel 30 JULIO)",
    bookingId: "8b53fffc-3e06-452c-b03d-9d17a0d721eb",
    hintTitle: "30 JULIO ",
    hintRow: 23,
  },
  {
    label: "Eleazar Salmerón (cancel 03 AGOSTO)",
    bookingId: "99980405-15af-456a-9daa-fa71d8ab5a00",
    hintTitle: "03 AGOSTO ",
    hintRow: 34,
  },
  {
    label: "Ulises Salazar (cancel 03 AGOSTO)",
    bookingId: "b69853c6-dfdb-47aa-836b-78ebca244bb8",
    hintTitle: "03 AGOSTO ",
    hintRow: 36,
  },
  {
    label: "Noé Hernández (cancel 03 AGOSTO)",
    bookingId: "b247bac5-69f5-409f-b4da-4e79b22e6355",
    hintTitle: "03 AGOSTO ",
    hintRow: 37,
  },
];

type SaJson = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type CloudLoc = {
  booking_id: string;
  expediente_id: string;
  inv_sheet_id: number | null;
  inv_sheet_title: string | null;
  inv_sheet_row: number | null;
  link_row: number | null;
  link_title: string | null;
};

function loadServiceAccount(): SaJson {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return JSON.parse(inline) as SaJson;
  const path =
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH?.trim();
  if (!path) {
    throw new Error(
      "Faltan credenciales: GOOGLE_APPLICATION_CREDENTIALS o GOOGLE_SERVICE_ACCOUNT_JSON",
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as SaJson;
}

async function googleAccessToken(sa: SaJson): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const claim = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const sig = signer.sign(sa.private_key, "base64url");
  const jwt = `${unsigned}.${sig}`;
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token_failed:${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token_missing");
  return json.access_token;
}

async function getValues(
  token: string,
  spreadsheetId: string,
  rangeA1: string,
): Promise<string[][]> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${
      encodeURIComponent(spreadsheetId)
    }/values/${encodeURIComponent(rangeA1)}?majorDimension=ROWS`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`sheets_read_failed:${res.status}:${body}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  return json.values ?? [];
}

async function listSheets(
  token: string,
  spreadsheetId: string,
): Promise<Array<{ sheetId: number; title: string }>> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${
      encodeURIComponent(spreadsheetId)
    }?fields=sheets.properties(sheetId,title)`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sheets_meta_failed:${res.status}`);
  const json = (await res.json()) as {
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };
  return (json.sheets ?? []).map((s) => ({
    sheetId: Number(s.properties?.sheetId ?? 0),
    title: String(s.properties?.title ?? ""),
  }));
}

function queryLinkedJson(sql: string): unknown {
  const r = spawnSync(
    "npx",
    ["supabase", "db", "query", "--linked", "-f", "/dev/stdin"],
    {
      input: sql,
      encoding: "utf8",
      cwd: process.cwd(),
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || "db query failed");
  }
  const out = String(r.stdout ?? "");
  const start = out.indexOf("{");
  if (start < 0) throw new Error("no JSON in db query output");
  return JSON.parse(out.slice(start));
}

async function main() {
  const sa = loadServiceAccount();
  const token = await googleAccessToken(sa);
  const liveTabs = await listSheets(token, SPREADSHEET_ID);

  const ids = TARGETS.map((t) => t.bookingId);
  let byId = new Map<string, CloudLoc>();
  try {
    const sql = `
SELECT jsonb_agg(q) AS rows FROM (
  SELECT
    b.id::text AS booking_id,
    b.expediente_id::text,
    i.sheet_id AS inv_sheet_id,
    i.sheet_title AS inv_sheet_title,
    i.sheet_row AS inv_sheet_row,
    l.row_number AS link_row,
    l.sheet_title AS link_title
  FROM agenda_bookings b
  LEFT JOIN LATERAL (
    SELECT * FROM agenda_sheet_slot_inventory ii
    WHERE ii.booking_id = b.id LIMIT 1
  ) i ON TRUE
  LEFT JOIN LATERAL (
    SELECT * FROM agenda_sheet_slot_links ll
    WHERE ll.booking_id = b.id
    ORDER BY ll.deleted_at NULLS FIRST LIMIT 1
  ) l ON TRUE
  WHERE b.id IN (${ids.map((id) => `'${id}'::uuid`).join(",")})
) q;
`;
    const parsed = queryLinkedJson(sql) as {
      rows?: Array<{ rows?: CloudLoc[] | null }>;
    };
    const cloudRows = (parsed.rows?.[0]?.rows ?? []) as CloudLoc[];
    byId = new Map(cloudRows.map((r) => [r.booking_id, r]));
  } catch (e) {
    console.warn("Cloud location lookup skipped:", String(e).slice(0, 120));
  }

  const report = [];
  for (const t of TARGETS) {
    const c = byId.get(t.bookingId);
    let sheetId = c?.inv_sheet_id ?? 0;
    let title = c?.inv_sheet_title ?? c?.link_title ?? t.hintTitle ?? "";
    const row = Number(c?.inv_sheet_row ?? c?.link_row ?? t.hintRow ?? 0);
    if (sheetId > 0) {
      const hit = liveTabs.find((x) => x.sheetId === sheetId);
      if (hit?.title) title = hit.title;
    } else if (title) {
      const hit = liveTabs.find((x) => x.title === title);
      if (hit) sheetId = hit.sheetId;
    }
    if (!(row > 0) || !title) {
      report.push({
        label: t.label,
        booking_id: t.bookingId,
        classification: "ambiguous" as CancelClearClassification,
        reason: "sin fila/título para lectura live",
        source: "live_sheets",
      });
      continue;
    }
    const range = a1FullReadRange(title, row);
    const values = await getValues(token, SPREADSHEET_ID, range);
    const fr = values[0] ?? [];
    // Normalizar a 21 columnas
    while (fr.length < 21) fr.push("");
    const decision = classifyCancelRowClearance({
      row: fr,
      cancelledBookingId: t.bookingId,
      cancelledExpedienteId: c?.expediente_id,
    });
    const live = summarizeLiveRowAU(fr);
    report.push({
      label: t.label,
      booking_id: t.bookingId,
      spreadsheet: SPREADSHEET_ID,
      sheetId,
      sheet_title_exact: title,
      title_len: title.length,
      row_number: row,
      range_read: range,
      live_A_F: live.A_F,
      live_O_U: live.O_U,
      live_G_N_has_data: live.G_N_has_data,
      live_G_N: live.G_N_preview,
      classification: decision.classification,
      reason: decision.reason,
      conflictingColumns: decision.conflictingColumns,
      terminalNoRetry: decision.terminalNoRetry,
      clear_ranges:
        decision.classification === "safe_to_clear"
          ? cancelClearBatchRanges(title, row)
          : [],
      action:
        decision.classification === "safe_to_clear"
          ? "batchClear_B_D_and_O_U_keep_A_and_G_N"
          : decision.classification === "manual_result_conflict"
          ? "manual_review_dead_no_retry"
          : decision.classification === "already_absent"
          ? "noop_done"
          : decision.classification === "row_reused"
          ? "noop_protect_new_booking"
          : "review",
      proposed_enqueue: decision.classification === "safe_to_clear",
      source: "live_sheets",
    });
  }

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "cancel-clear-dry-run-live.json");
  const summary = {
    generatedAt: new Date().toISOString(),
    source: "google_sheets_live_A_U",
    safe_to_clear: report
      .filter((r) => r.classification === "safe_to_clear")
      .map((r) => r.label),
    manual_result_conflict: report
      .filter((r) => r.classification === "manual_result_conflict")
      .map((r) => r.label),
    report,
  };
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  // No imprimir secretos ni JWT
  console.log(JSON.stringify(summary, null, 2));
  console.error(`wrote ${outPath}`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
