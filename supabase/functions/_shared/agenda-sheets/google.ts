/**
 * Google Sheets adapter (service account JWT → access token → Sheets API).
 * No secrets in logs. Injectable for tests via fetch override.
 */

export type SheetMeta = {
  sheetId: number;
  title: string;
  hidden: boolean;
};

export type SheetsAdapter = {
  getValues: (rangeA1: string) => Promise<string[][]>;
  updateValues: (rangeA1: string, values: string[][]) => Promise<void>;
  /**
   * Escritura multi-rango atómica (p.ej. B:D + O:U). Nunca debe incluir A.
   */
  batchUpdateValues: (
    data: ReadonlyArray<{ range: string; values: string[][] }>,
  ) => Promise<void>;
  /**
   * Borra solo userEnteredValue en los rangos dados (formato/fórmulas/validaciones
   * /bordes/altura intactos). Preferido para cancelación B:D + O:U.
   */
  batchClear: (rangesA1: string[]) => Promise<void>;
  /**
   * Spreadsheet.batchUpdate (insertDimension / deleteDimension / repeatCell / copyPaste).
   * Usado por reagendado histórico + replacement.
   */
  batchUpdateSpreadsheet: (requests: readonly object[]) => Promise<void>;
  /** Solo metadatos de pestañas (sin valores de celdas). */
  listSheets: () => Promise<SheetMeta[]>;
};

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function signJwtRs256(
  email: string,
  privateKeyPem: string,
  scope: string,
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj: unknown) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const unsigned = `${enc(header)}.${enc(claim)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${unsigned}.${sigB64}`;
}

export async function createGoogleSheetsAdapter(input: {
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
}): Promise<SheetsAdapter> {
  const fetchFn = input.fetchImpl ?? fetch;
  const jwt = await signJwtRs256(
    input.serviceAccountEmail,
    input.privateKeyPem.replace(/\\n/g, "\n"),
    "https://www.googleapis.com/auth/spreadsheets",
  );
  const tokenRes = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error("google_oauth_failed");
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenJson.access_token;
  if (!accessToken) throw new Error("google_oauth_missing_token");

  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}`;

  return {
    async getValues(rangeA1: string) {
      const url = `${base}/values/${encodeURIComponent(rangeA1)}?majorDimension=ROWS`;
      const res = await fetchFn(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 180);
        throw new Error(`google_sheets_read_failed:${res.status}:${body}`);
      }
      const json = (await res.json()) as { values?: string[][] };
      return json.values ?? [];
    },
    async updateValues(rangeA1: string, values: string[][]) {
      const url = `${base}/values/${encodeURIComponent(rangeA1)}?valueInputOption=USER_ENTERED`;
      const res = await fetchFn(url, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) throw new Error("google_sheets_write_failed");
    },
    async batchUpdateValues(data) {
      const entries = (data ?? []).filter((d) => String(d.range ?? "").trim());
      if (entries.length === 0) return;
      const url = `${base}/values:batchUpdate`;
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          valueInputOption: "USER_ENTERED",
          data: entries.map((d) => ({
            range: d.range,
            majorDimension: "ROWS",
            values: d.values,
          })),
        }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 180);
        throw new Error(`google_sheets_batch_update_failed:${res.status}:${body}`);
      }
    },
    async batchClear(rangesA1: string[]) {
      const ranges = (rangesA1 ?? []).filter((r) => String(r).trim());
      if (ranges.length === 0) return;
      const url = `${base}/values:batchClear`;
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ranges }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 180);
        throw new Error(`google_sheets_batch_clear_failed:${res.status}:${body}`);
      }
    },
    async batchUpdateSpreadsheet(requests) {
      const reqs = [...(requests ?? [])];
      if (reqs.length === 0) return;
      const url = `${base}:batchUpdate`;
      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ requests: reqs }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 180);
        throw new Error(
          `google_sheets_spreadsheet_batch_update_failed:${res.status}:${body}`,
        );
      }
    },
    async listSheets() {
      const url =
        `${base}?fields=sheets.properties(sheetId,title,hidden)`;
      const res = await fetchFn(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("google_sheets_meta_failed");
      const json = (await res.json()) as {
        sheets?: Array<{
          properties?: { sheetId?: number; title?: string; hidden?: boolean };
        }>;
      };
      return (json.sheets ?? []).map((s) => ({
        sheetId: Number(s.properties?.sheetId ?? 0),
        title: String(s.properties?.title ?? ""),
        hidden: Boolean(s.properties?.hidden),
      }));
    },
  };
}

/** Mock adapter for unit tests (no network). */
export function createMemorySheetsAdapter(
  store: Map<string, string[][]>,
  sheets: SheetMeta[] = [],
  opts?: { onBatchClear?: (ranges: string[]) => void },
): SheetsAdapter {
  return {
    async getValues(rangeA1: string) {
      return store.get(rangeA1) ?? [];
    },
    async updateValues(rangeA1: string, values: string[][]) {
      store.set(rangeA1, values);
    },
    async batchUpdateValues(data) {
      for (const d of data) {
        const m = /^'([^']*(?:''[^']*)*)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(
          d.range,
        );
        if (!m) {
          store.set(d.range, d.values);
          continue;
        }
        const title = m[1]!.replace(/''/g, "'");
        const startCol = m[2]!;
        const row = m[3]!;
        const endCol = m[4]!;
        const fullKey = `'${title.replace(/'/g, "''")}'!A${row}:U${row}`;
        const existing = store.get(fullKey)?.[0] ?? [];
        const rowVals = Array.from({ length: 21 }, (_, i) =>
          String(existing[i] ?? ""),
        );
        const colIndex = (letters: string) => {
          let n = 0;
          for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
          return n - 1;
        };
        const from = colIndex(startCol);
        const vals = d.values[0] ?? [];
        for (let i = 0; i < vals.length; i++) {
          rowVals[from + i] = String(vals[i] ?? "");
        }
        // Sanity: no permitir escritura que toque A vía este helper de tests
        if (from === 0) {
          throw new Error("memory_adapter_refuses_write_starting_at_A");
        }
        void endCol;
        store.set(fullKey, [rowVals]);
        store.set(d.range, d.values);
      }
    },
    async batchClear(rangesA1: string[]) {
      opts?.onBatchClear?.(rangesA1);
      for (const range of rangesA1) {
        // Memoria: vaciar fila conocida si el store tiene el rango A:U completo
        // (tests usan getValues sobre A:U; clear no escribe A).
        const m = /^'([^']*(?:''[^']*)*)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(
          range,
        );
        if (!m) continue;
        const title = m[1]!.replace(/''/g, "'");
        const startCol = m[2]!;
        const row = m[3]!;
        const endCol = m[4]!;
        const fullKey = `'${title.replace(/'/g, "''")}'!A${row}:U${row}`;
        const existing = store.get(fullKey);
        if (!existing?.[0]) continue;
        const rowVals = [...existing[0]];
        const colIndex = (letters: string) => {
          let n = 0;
          for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
          return n - 1;
        };
        const from = colIndex(startCol);
        const to = colIndex(endCol);
        for (let i = from; i <= to; i++) rowVals[i] = "";
        store.set(fullKey, [rowVals]);
      }
    },
    async batchUpdateSpreadsheet(_requests) {
      // Memory adapter: no-op estructural (tests de dominio no mutan grid aquí).
      void _requests;
    },
    async listSheets() {
      return sheets;
    },
  };
}
