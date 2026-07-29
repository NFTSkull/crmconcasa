#!/usr/bin/env npx tsx
/**
 * Auditoría read-only Agenda ↔ Google Sheets «CITAS 2026».
 * - Si hay credenciales de service account: lee Spreadsheet (solo GET).
 * - Si no: dry-run local + reporta exactamente el acceso faltante.
 * Nunca escribe celdas, columnas, triggers ni Apps Script.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSign } from "node:crypto";
import {
  AGENDA_SHEETS_DEFAULT_SPREADSHEET_ID,
  AGENDA_SHEETS_TIMEZONE,
  AGENDA_SHEET_TECH_COLUMNS,
  buildAgendaSheetsDryRunReport,
  enumerateSheetSlots,
  normalizeSheetNss,
  parseSheetTabDate,
  parseYearFromSpreadsheetTitle,
  sheetLocalDateTimeToIso,
} from "../src/domain/agenda-sheets";

const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() ||
  AGENDA_SHEETS_DEFAULT_SPREADSHEET_ID;

const OUT_DIR = join(process.cwd(), "tmp");
const OUT_FILE = join(OUT_DIR, "agenda-sheets-readonly-audit.json");

type SaJson = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function maskNss(raw: string): string {
  const n = normalizeSheetNss(raw);
  if (!n.ok) {
    const s = String(raw ?? "").replace(/\s/g, "");
    if (s.length < 5) return "***";
    return `${s.slice(0, 3)}******${s.slice(-2)}`;
  }
  return `${n.value.slice(0, 3)}******${n.value.slice(-2)}`;
}

function loadServiceAccount(): SaJson | null {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    try {
      return JSON.parse(inline) as SaJson;
    } catch {
      return null;
    }
  }
  const path =
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH?.trim();
  if (!path) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    return JSON.parse(fs.readFileSync(path, "utf8")) as SaJson;
  } catch {
    return null;
  }
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
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`token_failed:${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token_missing");
  return json.access_token;
}

type SheetProps = {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
};

async function fetchSpreadsheetMeta(
  token: string,
): Promise<{ title: string; sheets: SheetProps[] }> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}` +
    `?fields=properties.title,sheets.properties(sheetId,title,gridProperties)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`meta_failed:${res.status}`);
  const json = (await res.json()) as {
    properties?: { title?: string };
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number; columnCount?: number };
      };
    }>;
  };
  return {
    title: json.properties?.title ?? "",
    sheets: (json.sheets ?? []).map((s) => ({
      sheetId: Number(s.properties?.sheetId ?? 0),
      title: String(s.properties?.title ?? ""),
      rowCount: Number(s.properties?.gridProperties?.rowCount ?? 0),
      columnCount: Number(s.properties?.gridProperties?.columnCount ?? 0),
    })),
  };
}

async function fetchSheetValues(
  token: string,
  title: string,
): Promise<string[][]> {
  // Solo lectura. Incluye A:U para auditar H:N (PRESERVAR) y O:U (técnicas).
  const range = `'${title.replace(/'/g, "''")}'!A1:U200`;
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}/values/` +
    `${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`values_failed:${res.status}:${title}`);
  const json = (await res.json()) as { values?: string[][] };
  return (json.values ?? []).map((row) =>
    row.map((c) => (c == null ? "" : String(c))),
  );
}

function auditTechColumns(rows: string[][]): {
  totallyEmpty: boolean;
  hasHeaders: boolean;
  hasData: boolean;
  sampleNonEmpty: Array<{ row: number; col: string; kind: string }>;
  safeToUse: boolean;
  preserveHN: "PRESERVAR";
} {
  const cols = ["O", "P", "Q", "R", "S", "T", "U"] as const;
  const colIdx = { O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19, U: 20 };
  const sampleNonEmpty: Array<{ row: number; col: string; kind: string }> = [];
  let hasData = false;
  let hasHeaders = false;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (const col of cols) {
      const cell = String(row[colIdx[col]] ?? "").trim();
      if (!cell) continue;
      hasData = true;
      const upper = cell.toUpperCase();
      if (
        upper.includes("BOOKING") ||
        upper.includes("ESTADO") ||
        upper.includes("SYNC") ||
        upper.includes("EXPEDIENTE")
      ) {
        hasHeaders = true;
      }
      if (sampleNonEmpty.length < 8) {
        sampleNonEmpty.push({
          row: r + 1,
          col,
          kind: cell.startsWith("=") ? "formula_or_text" : "text",
        });
      }
    }
  }
  return {
    totallyEmpty: !hasData,
    hasHeaders,
    hasData,
    sampleNonEmpty,
    safeToUse: !hasData,
    preserveHN: "PRESERVAR",
  };
}

function analyzeTab(input: {
  title: string;
  sheetId: number;
  rowCount: number;
  columnCount: number;
  rows: string[][];
  year: number;
}) {
  const titleExact = input.title;
  const titleNormalized = titleExact.trim().replace(/\s+/g, " ");
  const leadingTrailingWs = titleExact !== titleExact.trim();
  const leadingZeroDay = /^\s*0\d\s+/u.test(titleExact);
  const date = parseSheetTabDate(titleExact, input.year);
  const sections: Array<{
    header: string;
    sede: string;
    kind: string;
    sectionStartRow: number;
    headerRow: number | null;
    firstSlotRow: number | null;
    lastSlotRow: number | null;
    slotRows: number;
    occupied: number;
    free: number;
    hours: Record<string, number>;
  }> = [];
  const warnings: string[] = [];
  const nssAnomalies: Array<{ row: number; masked: string; issue: string }> = [];

  if (!date.ok) {
    return {
      sheetId: input.sheetId,
      sheetTitleExact: titleExact,
      sheetTitleNormalized: titleNormalized,
      sheetDate: null as string | null,
      validDateTab: false,
      leadingTrailingWs,
      leadingZeroDay,
      rowCount: input.rowCount,
      columnCount: input.columnCount,
      recognizedSections: [] as typeof sections,
      technicalColumns: auditTechColumns(input.rows),
      technicalColumnsSafe: auditTechColumns(input.rows).safeToUse,
      nssAnomalies,
      warnings: [date.error, ...(leadingTrailingWs ? ["espacios en título"] : [])],
    };
  }

  const slots = enumerateSheetSlots({
    sheetDate: date.value,
    rows: input.rows,
    startRowNumber: 1,
  });

  // Detectar inicios de sección por fila
  const sectionStarts: Array<{
    row: number;
    header: string;
    sede: string;
    kind: string;
  }> = [];
  for (let i = 0; i < input.rows.length; i++) {
    const a = String(input.rows[i]?.[0] ?? "");
    const n = a
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const map: Record<string, { sede: string; kind: string }> = {
      "MONTERREY FIRMAS": { sede: "monterrey", kind: "firmas" },
      "MONTERREY BIOMETRICOS": { sede: "monterrey", kind: "biometricos" },
      "APODACA FIRMAS": { sede: "apodaca", kind: "firmas" },
      "APODACA BIOMETRICOS": { sede: "apodaca", kind: "biometricos" },
    };
    if (map[n]) {
      sectionStarts.push({
        row: i + 1,
        header: a.trim(),
        sede: map[n].sede,
        kind: map[n].kind,
      });
    }
  }

  for (const sec of sectionStarts) {
    const secSlots = slots.filter(
      (s) => s.sede === sec.sede && s.kind === sec.kind,
    );
    const hours: Record<string, number> = {};
    let occupied = 0;
    for (const s of secSlots) {
      hours[s.slotTime] = (hours[s.slotTime] ?? 0) + 1;
      if (String(s.nssRaw ?? "").trim()) occupied += 1;
      const raw = String(s.nssRaw ?? "");
      if (!raw.trim()) continue;
      if (/^['´`’]/.test(raw.trim())) {
        nssAnomalies.push({
          row: s.rowNumber,
          masked: maskNss(raw),
          issue: "apostrofe_inicial",
        });
      }
      if (/\s/.test(raw)) {
        nssAnomalies.push({
          row: s.rowNumber,
          masked: maskNss(raw),
          issue: "espacios",
        });
      }
      if (/-/.test(raw)) {
        nssAnomalies.push({
          row: s.rowNumber,
          masked: maskNss(raw),
          issue: "guiones",
        });
      }
      const norm = normalizeSheetNss(raw);
      if (!norm.ok) {
        nssAnomalies.push({
          row: s.rowNumber,
          masked: maskNss(raw),
          issue: "no_11_digitos",
        });
      } else if (norm.value.startsWith("0")) {
        nssAnomalies.push({
          row: s.rowNumber,
          masked: maskNss(raw),
          issue: "cero_inicial_ok",
        });
      }
      if (norm.ok && !String(s.nombreRaw ?? "").trim()) {
        nssAnomalies.push({
          row: s.rowNumber,
          masked: maskNss(raw),
          issue: "nss_sin_nombre",
        });
      }
    }
    for (const s of secSlots) {
      if (!String(s.nssRaw ?? "").trim() && String(s.nombreRaw ?? "").trim()) {
        nssAnomalies.push({
          row: s.rowNumber,
          masked: "***",
          issue: "nombre_sin_nss",
        });
      }
    }
    sections.push({
      header: sec.header,
      sede: sec.sede,
      kind: sec.kind,
      sectionStartRow: sec.row,
      headerRow: secSlots[0] ? secSlots[0].rowNumber - 1 : null,
      firstSlotRow: secSlots[0]?.rowNumber ?? null,
      lastSlotRow: secSlots[secSlots.length - 1]?.rowNumber ?? null,
      slotRows: secSlots.length,
      occupied,
      free: secSlots.length - occupied,
      hours,
    });
  }

  if (sectionStarts.length === 0 && date.ok) {
    warnings.push("fecha_valida_sin_secciones_reconocidas");
  }
  if (leadingTrailingWs) warnings.push("espacios_en_titulo");
  if (leadingZeroDay) warnings.push("dia_con_cero_inicial");

  const tech = auditTechColumns(input.rows);
  return {
    sheetId: input.sheetId,
    sheetTitleExact: titleExact,
    sheetTitleNormalized: titleNormalized,
    sheetDate: date.value,
    validDateTab: true,
    leadingTrailingWs,
    leadingZeroDay,
    rowCount: input.rowCount,
    columnCount: input.columnCount,
    recognizedSections: sections,
    technicalColumns: tech,
    technicalColumnsSafe: tech.safeToUse,
    nssAnomalies: nssAnomalies.slice(0, 50),
    warnings,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const sa = loadServiceAccount();
  const tzChecks = (["08:30", "10:00", "23:30", "00:30"] as const).map((hm) => {
    const r = sheetLocalDateTimeToIso("2026-08-03", hm);
    return {
      time: hm,
      iso: r.ok ? r.value : null,
      datePreserved: r.ok ? r.value.startsWith("2026-08-03") : false,
      sheetTz: AGENDA_SHEETS_TIMEZONE,
      crmTz: "America/Monterrey",
      offset: "-06:00",
    };
  });

  const baseReport: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
    sheetModified: false,
    writeOperationsAttempted: false,
    access: {
      hasServiceAccount: Boolean(sa),
      readonlyScopeRequested: "spreadsheets.readonly",
      missing: sa
        ? []
        : [
            "GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_APPLICATION_CREDENTIALS",
            "Service account compartida como Lector en el Spreadsheet",
          ],
    },
    proposedTechColumns: AGENDA_SHEET_TECH_COLUMNS,
    timezone: tzChecks,
    tabs: [] as unknown[],
    dryRun: null as unknown,
    verdictHint: "pending",
  };

  if (!sa) {
    // Dry-run local con fixture estructural (no es la hoja real).
    const fixtureTabs = [
      {
        title: "29 JULIO",
        sheetId: 1288978311,
        rows: [
          ["MONTERREY FIRMAS"],
          ["HORA", "NSS", "NOMBRE", "ASESOR"],
          ["10:00 AM", "", "", ""],
          ["10:00 AM", "", "", ""],
          ["CITAS CANCELADAS"],
          ["MONTERREY BIOMETRICOS"],
          ["HORA", "NSS", "NOMBRE", "ASESOR"],
          ["8:30 AM", "´03179461821", "Cliente Demo", "Asesor"],
          ["8:30 AM", "", "", ""],
          ["NO HAY CITAS"],
          ["APODACA FIRMAS"],
          ["HORA", "NSS", "NOMBRE", "ASESOR"],
          ["9:00 AM", "", "", ""],
          ["APODACA BIOMETRICOS"],
          ["HORA", "NSS", "NOMBRE", "ASESOR"],
          ["9:30AM", "031-794-61822", "Otro", "Asesor"],
        ],
      },
      { title: "30 JULIO ", sheetId: 2, rows: [["FORMATO"]] },
      { title: "03 AGOSTO ", sheetId: 3, rows: [] },
      { title: "FORMATO", sheetId: 4, rows: [["plantilla"]] },
    ];
    const year = parseYearFromSpreadsheetTitle("CITAS 2026");
    const y = year.ok ? year.value : 2026;
    baseReport.tabs = fixtureTabs.map((t) =>
      analyzeTab({
        title: t.title,
        sheetId: t.sheetId,
        rowCount: t.rows.length,
        columnCount: 14,
        rows: t.rows,
        year: y,
      }),
    );
    baseReport.dryRun = buildAgendaSheetsDryRunReport({
      year: y,
      tabs: fixtureTabs,
      crmBookings: [],
    });
    baseReport.verdictHint = "NO_LIVE_SHEET_ACCESS";
    baseReport.note =
      "Sin credenciales de lectura: no se auditó la hoja real. Solo dry-run local + parsers. No se modificó ninguna celda.";
    writeFileSync(OUT_FILE, JSON.stringify(baseReport, null, 2), "utf8");
    console.log(JSON.stringify({ ok: true, mode: "offline", out: OUT_FILE }, null, 2));
    return;
  }

  const token = await googleAccessToken(sa);
  const meta = await fetchSpreadsheetMeta(token);
  const yearP = parseYearFromSpreadsheetTitle(meta.title);
  const year = yearP.ok ? yearP.value : 2026;
  const liveTabs: Array<{ title: string; sheetId: number; rows: string[][] }> =
    [];
  for (const sh of meta.sheets) {
    const rows = await fetchSheetValues(token, sh.title);
    liveTabs.push({ title: sh.title, sheetId: sh.sheetId, rows });
  }
  baseReport.spreadsheetTitle = meta.title;
  baseReport.tabs = liveTabs.map((t, i) =>
    analyzeTab({
      title: t.title,
      sheetId: t.sheetId,
      rowCount: meta.sheets[i]?.rowCount ?? t.rows.length,
      columnCount: meta.sheets[i]?.columnCount ?? 14,
      rows: t.rows,
      year,
    }),
  );
  baseReport.dryRun = buildAgendaSheetsDryRunReport({
    year,
    tabs: liveTabs,
    crmBookings: [],
  });
  baseReport.verdictHint = "LIVE_READONLY_OK";
  baseReport.sheetModified = false;
  writeFileSync(OUT_FILE, JSON.stringify(baseReport, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "live-readonly",
        tabs: meta.sheets.length,
        out: OUT_FILE,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
