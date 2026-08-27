/**
 * Google Sheets READ-ONLY adapter for structure audit.
 * Scope: spreadsheets.readonly. Solo GET. Sin métodos de escritura en la interfaz.
 */

export type ReadOnlyStructureSheetsAdapter = {
  /** spreadsheets.get (metadata + gridData acotado). Solo GET. */
  getSpreadsheetStructure: (input: {
    rangesA1: readonly string[];
    includeGridData: boolean;
  }) => Promise<unknown>;
  /** values.batchGet — solo GET. */
  batchGetValues: (
    rangesA1: readonly string[],
  ) => Promise<Map<string, string[][]>>;
  listSheets: () => Promise<
    ReadonlyArray<{
      sheetId: number;
      title: string;
      hidden: boolean;
      rowCount: number | null;
      columnCount: number | null;
    }>
  >;
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

/**
 * Adapter estructural SOLO lectura. No expone mutaciones de celdas ni de dimensiones.
 */
export async function createReadOnlyStructureSheetsAdapter(input: {
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
}): Promise<ReadOnlyStructureSheetsAdapter> {
  const fetchFn = input.fetchImpl ?? fetch;
  const jwt = await signJwtRs256(
    input.serviceAccountEmail,
    input.privateKeyPem.replace(/\\n/g, "\n"),
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  );
  const tokenRes = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) throw new Error("google_oauth_failed");
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const accessToken = tokenJson.access_token;
  if (!accessToken) throw new Error("google_oauth_missing_token");

  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}`;

  return {
    async listSheets() {
      const url =
        `${base}?fields=sheets.properties(sheetId,title,hidden,gridProperties(rowCount,columnCount))`;
      const res = await fetchFn(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("google_sheets_meta_failed");
      const json = (await res.json()) as {
        sheets?: Array<{
          properties?: {
            sheetId?: number;
            title?: string;
            hidden?: boolean;
            gridProperties?: { rowCount?: number; columnCount?: number };
          };
        }>;
      };
      return (json.sheets ?? []).map((s) => ({
        sheetId: Number(s.properties?.sheetId ?? 0),
        title: String(s.properties?.title ?? ""),
        hidden: Boolean(s.properties?.hidden),
        rowCount: s.properties?.gridProperties?.rowCount ?? null,
        columnCount: s.properties?.gridProperties?.columnCount ?? null,
      }));
    },

    async getSpreadsheetStructure(inputRanges) {
      const ranges = (inputRanges.rangesA1 ?? [])
        .map((r) => String(r ?? "").trim())
        .filter(Boolean);
      const qs: string[] = [];
      for (const r of ranges) qs.push(`ranges=${encodeURIComponent(r)}`);
      if (inputRanges.includeGridData) qs.push("includeGridData=true");
      // Campos estructurales; evita dumps enormes de PII en logs del edge.
      qs.push(
        "fields=" +
          encodeURIComponent(
            [
              "spreadsheetId",
              "sheets.properties(sheetId,title,hidden,gridProperties)",
              "sheets.merges",
              "sheets.data.startRow",
              "sheets.data.startColumn",
              "sheets.data.rowMetadata(pixelSize,hiddenByUser,hiddenByFilter)",
              "sheets.data.rowData.values(" +
                [
                  "userEnteredValue",
                  "effectiveValue",
                  "effectiveFormat",
                  "dataValidation",
                  "note",
                ].join(",") +
                ")",
            ].join(","),
          ),
      );
      const url = `${base}?${qs.join("&")}`;
      const res = await fetchFn(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 180);
        throw new Error(`google_sheets_structure_get_failed:${res.status}:${body}`);
      }
      return await res.json();
    },

    async batchGetValues(rangesA1) {
      const ranges = (rangesA1 ?? []).map((r) => String(r ?? "").trim()).filter(Boolean);
      const out = new Map<string, string[][]>();
      if (ranges.length === 0) return out;
      const CHUNK = 40;
      for (let i = 0; i < ranges.length; i += CHUNK) {
        const chunk = ranges.slice(i, i + CHUNK);
        const qs = chunk.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
        const url = `${base}/values:batchGet?majorDimension=ROWS&${qs}`;
        const res = await fetchFn(url, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const body = (await res.text()).slice(0, 180);
          throw new Error(`google_sheets_batch_get_failed:${res.status}:${body}`);
        }
        const json = (await res.json()) as {
          valueRanges?: Array<{ range?: string; values?: string[][] }>;
        };
        const vrs = json.valueRanges ?? [];
        for (let j = 0; j < chunk.length; j++) {
          out.set(chunk[j]!, vrs[j]?.values ?? []);
        }
      }
      return out;
    },
  };
}
