/**
 * Probe advisor JWT path for agenda-sheet-live-sync (pure fetch, no token output).
 */
import { execSync } from "node:child_process";

const PROJECT = "fvtqbxukqlajezyyvwzy";
const URL = `https://${PROJECT}.supabase.co`;
const FN_URL = `${URL}/functions/v1/agenda-sheet-live-sync`;

const keysJson = JSON.parse(
  execSync(`npx supabase projects api-keys --project-ref ${PROJECT}`, {
    encoding: "utf8",
  }),
);
const anon = keysJson.keys.find((k) => k.name === "anon")?.api_key;
const service = keysJson.keys.find((k) => k.name === "service_role")?.api_key;
if (!anon || !service) throw new Error("missing api keys");

async function adminFetch(path, init = {}) {
  const res = await fetch(`${URL}${path}`, {
    ...init,
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { res, json };
}

const orgRes = await adminFetch(
  "/rest/v1/profiles?select=organization_id&app_role=eq.asesor&active=eq.true&limit=1",
);
const orgId = orgRes.json?.[0]?.organization_id;
if (!orgId) throw new Error("no org for asesor");

const tag = `live-sync-probe-${Date.now()}`;
const email = `${tag}@concasa-probe.invalid`;
const password = `Probe!${Date.now()}x`;

const created = await adminFetch("/auth/v1/admin/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { probe: true },
  }),
});
if (!created.res.ok) {
  throw new Error(`createUser: ${created.res.status} ${JSON.stringify(created.json).slice(0, 200)}`);
}
const uid = created.json.id;

const profUpsert = await adminFetch("/rest/v1/profiles", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=representation",
  },
  body: JSON.stringify({
    id: uid,
    organization_id: orgId,
    app_role: "asesor",
    active: true,
    email,
  }),
});
if (!profUpsert.res.ok) {
  throw new Error(`profile upsert: ${profUpsert.res.status}`);
}

const signInRes = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anon, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const signInJson = await signInRes.json();
if (!signInRes.ok) {
  throw new Error(`signIn: ${signInRes.status}`);
}
const accessToken = signInJson.access_token;
if (!accessToken) throw new Error("no access_token");

async function runInvoke(label, body) {
  const t0 = Date.now();
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const json = await res.json().catch(() => null);
  const payload =
    json?.data && typeof json.data === "object" ? json.data : json;
  return {
    label,
    http: res.status,
    ms,
    code: payload?.code ?? json?.code ?? null,
    message:
      typeof (payload?.message ?? json?.message) === "string"
        ? String(payload?.message ?? json?.message).slice(0, 120)
        : null,
    fresh: payload?.fresh ?? null,
    refreshed: payload?.refreshed ?? null,
    slots: Array.isArray(payload?.slots) ? payload.slots.length : null,
    daily_remaining: payload?.daily_remaining ?? null,
    ok: payload?.ok ?? json?.ok ?? null,
  };
}

async function runRpc(body) {
  const res = await fetch(`${URL}/rest/v1/rpc/agenda_sheet_inventory_availability`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return {
    http: res.status,
    error: res.ok ? null : String(json?.message ?? res.status).slice(0, 120),
    fresh: json?.fresh ?? null,
    slots: Array.isArray(json?.slots) ? json.slots.length : null,
  };
}

const dates = ["2026-09-02", "2026-08-27", "2026-08-26"];
const runs = [];
for (const bookingDate of dates) {
  runs.push(
    await runInvoke(`availability:${bookingDate}`, {
      bookingDate,
      kind: "biometricos",
      locationId: "monterrey",
      mode: "availability",
    }),
  );
}
for (let i = 1; i <= 3; i++) {
  runs.push(
    await runInvoke(`repeat${i}:2026-09-02`, {
      bookingDate: "2026-09-02",
      kind: "biometricos",
      locationId: "monterrey",
      mode: "availability",
    }),
  );
}
runs.push(
  await runInvoke("book_gate:2026-09-02", {
    bookingDate: "2026-09-02",
    kind: "biometricos",
    locationId: "monterrey",
    mode: "book_gate",
    slotTime: "08:00",
  }),
);

const fallbackRpc = await runRpc({
  p_kind: "biometricos",
  p_date: "2026-09-02",
  p_location_id: "monterrey",
});

await adminFetch(`/auth/v1/admin/users/${uid}`, { method: "DELETE" });

console.log(
  JSON.stringify(
    {
      advisorSessionValid: true,
      profile: { app_role: "asesor", active: true, organization_id: orgId },
      runs,
      fallbackRpc,
    },
    null,
    2,
  ),
);
