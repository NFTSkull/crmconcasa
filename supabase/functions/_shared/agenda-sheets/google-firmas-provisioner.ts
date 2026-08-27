/**
 * Google Sheets WRITE adapter RESTRINGIDO para Firmas provisioner.
 * Scope completo spreadsheets (necesario para batchUpdate), pero la interfaz
 * solo expone batchUpdateSpreadsheet + lecturas. Toda mutación pasa por
 * assertProvisionerRequestsAllowed antes de enviarse.
 */
import {
  assertProvisionerRequestsAllowed,
  type ProvisionerAllowContext,
} from "./firmas-provisioner-plan.ts";

export type FirmasProvisionerSheetsAdapter = {
  listSheets: () => Promise<
    ReadonlyArray<{
      sheetId: number;
      title: string;
      hidden: boolean;
      rowCount: number | null;
    }>
  >;
  getValues: (rangeA1: string) => Promise<string[][]>;
  getSpreadsheetStructure: (input: {
    rangesA1: readonly string[];
    includeGridData: boolean;
  }) => Promise<unknown>;
  /**
   * Único mutador. Valida allowlist + contexto (filas nuevas / col A) antes de POST.
   */
  applyAllowlistedBatchUpdate: (
    requests: readonly object[],
    ctx: ProvisionerAllowContext,
  ) => Promise<void>;
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

export async function createFirmasProvisionerSheetsAdapter(input: {
  spreadsheetId: string;
  serviceAccountEmail: string;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
}): Promise<FirmasProvisionerSheetsAdapter> {
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
  if (!tokenRes.ok) throw new Error("google_oauth_token_failed");
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  const accessToken = String(tokenJson.access_token ?? "");
  if (!accessToken) throw new Error("google_oauth_token_missing");

  const base =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}`;

  return {
    async listSheets() {
      const url =
        `${base}?fields=sheets.properties(sheetId,title,hidden,gridProperties(rowCount))`;
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
            gridProperties?: { rowCount?: number };
          };
        }>;
      };
      return (json.sheets ?? []).map((s) => ({
        sheetId: Number(s.properties?.sheetId ?? 0),
        title: String(s.properties?.title ?? ""),
        hidden: Boolean(s.properties?.hidden),
        rowCount: s.properties?.gridProperties?.rowCount ?? null,
      }));
    },

    async getValues(rangeA1: string) {
      const url =
        `${base}/values/${encodeURIComponent(rangeA1)}?majorDimension=ROWS`;
      const res = await fetchFn(url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 180);
        throw new Error(`google_sheets_get_failed:${res.status}:${body}`);
      }
      const json = (await res.json()) as { values?: string[][] };
      return json.values ?? [];
    },

    async getSpreadsheetStructure(input2) {
      const qs = [
        `includeGridData=${input2.includeGridData ? "true" : "false"}`,
        ...input2.rangesA1.map((r) => `ranges=${encodeURIComponent(r)}`),
        "fields=sheets(properties,merges,data(startRow,rowMetadata,rowData(values(userEnteredValue,effectiveValue,userEnteredFormat,effectiveFormat,dataValidation,note))))",
      ].join("&");
      const res = await fetchFn(`${base}?${qs}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 180);
        throw new Error(`google_sheets_structure_failed:${res.status}:${body}`);
      }
      return await res.json();
    },

    async applyAllowlistedBatchUpdate(requests, ctx) {
      assertProvisionerRequestsAllowed(requests, ctx);
      if (requests.length === 0) return;
      const res = await fetchFn(`${base}:batchUpdate`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ requests }),
      });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 240);
        throw new Error(
          `google_sheets_provisioner_batch_update_failed:${res.status}:${body}`,
        );
      }
    },
  };
}
