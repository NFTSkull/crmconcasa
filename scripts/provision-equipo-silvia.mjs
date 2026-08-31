/**
 * Provision Team Silvia — Auth users + profiles + team members + capabilities.
 * Passwords ONLY from TEAM_SILVIA_USERS_FILE (private JSON). Never log passwords.
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TEAM_SILVIA_USERS_FILE — absolute path to private JSON
 *   TEAM_SILVIA_DRY_RUN=1 — report only
 *   TEAM_SILVIA_LEADER_EMAIL — default silvia.reyes@concasa.mx
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let ws;
try {
  ws = require("ws");
} catch {
  ws = undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const usersFile = process.env.TEAM_SILVIA_USERS_FILE;
const dryRun = process.env.TEAM_SILVIA_DRY_RUN === "1";
const leaderEmail = (
  process.env.TEAM_SILVIA_LEADER_EMAIL || "silvia.reyes@concasa.mx"
).toLowerCase();

const INTEGRATORS = new Set([
  "adriana.reyes@concasa.mx",
  "hector.nunez@concasa.mx",
]);

if (!url || !key) {
  console.error("Missing SUPABASE URL or SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!usersFile || !fs.existsSync(usersFile)) {
  console.error("TEAM_SILVIA_USERS_FILE missing or not found");
  process.exit(1);
}

/** @type {{ email: string, full_name: string, password: string }[]} */
const users = JSON.parse(fs.readFileSync(usersFile, "utf8"));
if (!Array.isArray(users) || users.length === 0) {
  console.error("Users file must be a non-empty JSON array");
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...(ws
    ? { realtime: { transport: ws } }
    : { realtime: { params: { eventsPerSecond: 0 } } }),
});

function redact(u) {
  return { email: u.email, full_name: u.full_name, has_password: Boolean(u.password) };
}

async function findProfileByEmail(email) {
  const { data, error } = await sb
    .from("profiles")
    .select("id,email,app_role,active,organization_id,full_name")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getAuthUserById(id) {
  const { data, error } = await sb.auth.admin.getUserById(id);
  if (error) return null;
  return data?.user ?? null;
}

async function createAuthUser(email, password) {
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

async function deleteAuthUser(id) {
  const { error } = await sb.auth.admin.deleteUser(id);
  if (error) throw error;
}

async function ensureProfile(userId, email, fullName, orgId) {
  const existing = await findProfileByEmail(email);
  if (existing) {
    if (existing.id !== userId) {
      throw new Error(
        `Profile email ${email} exists with different id; STOP (no password reset)`,
      );
    }
    return { profile: existing, created: false };
  }
  const { data, error } = await sb
    .from("profiles")
    .insert({
      id: userId,
      email,
      full_name: fullName,
      app_role: "asesor",
      active: true,
      organization_id: orgId,
      tipo_asesor_origen: "interno",
    })
    .select("id,email,app_role,active,organization_id,full_name")
    .single();
  if (error) throw error;
  return { profile: data, created: true };
}

async function main() {
  console.log(
    JSON.stringify({
      dry_run: dryRun,
      leader_email: leaderEmail,
      users_planned: users.map(redact),
      oziel_note: "OZIEL_BASE_CREATED_SPECIAL_ACCESS_PENDING",
    }),
  );

  const leader = await findProfileByEmail(leaderEmail);
  if (!leader || leader.app_role !== "asesor" || !leader.active) {
    throw new Error(`Leader ${leaderEmail} missing or not active asesor`);
  }
  const orgId = leader.organization_id;

  const { data: teams, error: teamErr } = await sb
    .from("asesor_equipos")
    .select("id,nombre,leader_id,active")
    .eq("leader_id", leader.id)
    .eq("active", true)
    .limit(1);
  if (teamErr) throw teamErr;
  if (!teams?.length) {
    throw new Error(
      "No active team for Silvia — apply migration seed first (asesor_equipos)",
    );
  }
  const teamId = teams[0].id;

  const report = [];

  for (const u of users) {
    const email = String(u.email || "").toLowerCase().trim();
    const fullName = String(u.full_name || "").trim();
    const password = String(u.password || "");
    if (!email || !fullName || !password) {
      report.push({ email, status: "STOP_INVALID_ROW" });
      continue;
    }

    const existingProfile = await findProfileByEmail(email);
    if (existingProfile) {
      report.push({
        email,
        status: "STOP_PROFILE_EXISTS",
        profile_id: existingProfile.id,
        note: "No password reset / no overwrite",
      });
      continue;
    }

    if (dryRun) {
      report.push({ email, status: "DRY_RUN_WOULD_CREATE", full_name: fullName });
      continue;
    }

    let authUser = null;
    try {
      authUser = await createAuthUser(email, password);
      const { profile, created } = await ensureProfile(
        authUser.id,
        email,
        fullName,
        orgId,
      );

      // team membership
      const { error: memErr } = await sb.from("asesor_equipo_miembros").upsert(
        { team_id: teamId, asesor_id: profile.id, active: true },
        { onConflict: "team_id,asesor_id" },
      );
      if (memErr) throw memErr;

      if (INTEGRATORS.has(email)) {
        for (const cap of [
          "create_for_any_advisor",
          "integrate_for_any_advisor",
        ]) {
          const { error: capErr } = await sb.from("profile_capabilities").upsert(
            { profile_id: profile.id, capability: cap, active: true },
            { onConflict: "profile_id,capability" },
          );
          if (capErr) throw capErr;
        }
      }

      report.push({
        email,
        status: "CREATED",
        auth_id: authUser.id,
        profile_created: created,
        team_member: true,
        integrators: INTEGRATORS.has(email),
        oziel_special:
          email === "oziel.hernandez@concasa.mx"
            ? "OZIEL_BASE_CREATED_SPECIAL_ACCESS_PENDING"
            : undefined,
      });
    } catch (err) {
      if (authUser?.id) {
        try {
          await deleteAuthUser(authUser.id);
        } catch (delErr) {
          console.error("compensating delete failed", email, delErr.message);
        }
      }
      report.push({
        email,
        status: "FAILED_ROLLED_AUTH",
        error: err.message || String(err),
      });
    }
  }

  // Ensure leader has team_dashboard_read (idempotent)
  if (!dryRun) {
    await sb.from("profile_capabilities").upsert(
      {
        profile_id: leader.id,
        capability: "team_dashboard_read",
        active: true,
      },
      { onConflict: "profile_id,capability" },
    );
  }

  console.log(JSON.stringify({ report }, null, 2));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
