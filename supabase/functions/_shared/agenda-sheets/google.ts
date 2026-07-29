/**
 * Google Sheets adapter (service account JWT → access token → Sheets API).
 * No secrets in logs. Injectable for tests via fetch override.
 */

export type SheetsAdapter = {
  getValues: (rangeA1: string) => Promise<string[][]>;
  updateValues: (rangeA1: string, values: string[][]) => Promise<void>;
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
      if (!res.ok) throw new Error("google_sheets_read_failed");
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
  };
}

/** Mock adapter for unit tests (no network). */
export function createMemorySheetsAdapter(
  store: Map<string, string[][]>,
): SheetsAdapter {
  return {
    async getValues(rangeA1: string) {
      return store.get(rangeA1) ?? [];
    },
    async updateValues(rangeA1: string, values: string[][]) {
      store.set(rangeA1, values);
    },
  };
}
