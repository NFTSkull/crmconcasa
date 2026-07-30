/**
 * Shared helpers for agenda-sheet Edge Functions (Deno).
 * Mirrors TS parsers in src/domain/agenda-sheets (keep in sync).
 */

export const DEFAULT_SPREADSHEET_ID =
  "1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA";

export const SHEETS_TZ = "America/Mexico_City";

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < ba.length; i++) out |= ba[i]! ^ bb[i]!;
  return out === 0;
}

export function normalizeNss(raw: string): string | null {
  let s = String(raw ?? "").trim().replace(/^['´`’]+/, "");
  s = s.replace(/[\s\-_.]/g, "").replace(/[^\d]/g, "");
  return /^\d{11}$/.test(s) ? s : null;
}

export function parseTabDate(tabTitle: string, year: number): string | null {
  const raw = String(tabTitle ?? "").trim().replace(/\s+/g, " ");
  const m = /^(\d{1,2})\s+([A-Za-záéíóúñÁÉÍÓÚÑ]+)$/u.exec(raw);
  if (!m) return null;
  const day = Number(m[1]);
  const monthKey = m[2]!
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const month = MONTHS[monthKey];
  if (!month || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseTime(raw: string): string | null {
  const t = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bA\.\s*M\.?/gi, "AM")
    .replace(/\bP\.\s*M\.?/gi, "PM")
    .toUpperCase();
  const m =
    /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(t) ??
    /^(\d{1,2}):(\d{2})(AM|PM)$/i.exec(t);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const ampm = (m[3] ?? "").toUpperCase();
  if (minute < 0 || minute > 59) return null;
  if (ampm === "AM" || ampm === "PM") {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) hour += 12;
  } else if (hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseSection(cellA: string): { sede: string; kind: string } | null {
  const n = String(cellA ?? "")
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
  return map[n] ?? null;
}

export function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function jsonOk(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
