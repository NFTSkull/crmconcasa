/**
 * Provision Team Silvia — Auth users + profiles + team members + capabilities.
 * Passwords ONLY from TEAM_SILVIA_USERS_FILE (private JSON). Never log passwords.
 *
 * Compensación inversa por usuario (solo objetos creados en esta corrida):
 *   capabilities → membership → profile → Auth
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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let ws;
try {
  ws = require("ws");
} catch {
  ws = undefined;
}

export const INTEGRATORS = new Set([
  "adriana.reyes@concasa.mx",
  "hector.nunez@concasa.mx",
]);

export const INTEGRATOR_CAPS = [
  "create_for_any_advisor",
  "integrate_for_any_advisor",
];

/** @typedef {{
 *   from: (table: string) => any,
 *   auth: { admin: {
 *     createUser: (args: any) => Promise<any>,
 *     deleteUser: (id: string) => Promise<any>,
 *     listUsers: (args?: any) => Promise<any>,
 *     getUserById: (id: string) => Promise<any>,
 *   }}
 * }} ProvisionClient */

export function redactUserRow(u) {
  return {
    email: u.email,
    full_name: u.full_name,
    has_password: Boolean(u.password),
  };
}

export function isAuthAlreadyExistsError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const status = err?.status || err?.code;
  return (
    status === 422 ||
    status === "user_already_exists" ||
    msg.includes("already been registered") ||
    msg.includes("already registered") ||
    msg.includes("user already exists") ||
    msg.includes("email_exists")
  );
}

/**
 * Compensa en orden inverso. Solo borra lo creado en esta corrida.
 * @returns {{ ok: boolean, left: string[] }}
 */
export async function compensateUserCreates(deps, state) {
  const left = [];
  const {
    deleteCapability,
    deleteMembership,
    deleteProfile,
    deleteAuthUser,
  } = deps;

  for (const cap of [...(state.capabilitiesCreated || [])].reverse()) {
    try {
      await deleteCapability(state.profileId, cap);
    } catch {
      left.push(`capability:${cap}`);
    }
  }
  state.capabilitiesCreated = [];

  if (state.membershipCreated) {
    try {
      await deleteMembership(state.teamId, state.profileId);
      state.membershipCreated = false;
    } catch {
      left.push("membership");
    }
  }

  if (state.profileCreated && state.profileId) {
    try {
      await deleteProfile(state.profileId);
      state.profileCreated = false;
    } catch {
      left.push("profile");
    }
  }

  if (state.authCreated && state.authId) {
    try {
      await deleteAuthUser(state.authId);
      state.authCreated = false;
    } catch {
      left.push("auth");
    }
  }

  return { ok: left.length === 0, left };
}

/**
 * Provisiona un usuario. Pure-ish para tests con deps inyectadas.
 */
export async function provisionOneUser(deps, input) {
  const {
    findProfileByEmail,
    findAuthByEmail,
    createAuthUser,
    createProfile,
    createMembership,
    createCapability,
    compensate,
  } = deps;

  const email = String(input.email || "").toLowerCase().trim();
  const fullName = String(input.full_name || "").trim();
  const password = String(input.password || "");

  /** @type {{
   *   email: string,
   *   authCreated: boolean,
   *   profileCreated: boolean,
   *   membershipCreated: boolean,
   *   capabilitiesCreated: string[],
   *   authId?: string,
   *   profileId?: string,
   *   teamId: string,
   * }} */
  const state = {
    email,
    authCreated: false,
    profileCreated: false,
    membershipCreated: false,
    capabilitiesCreated: [],
    teamId: input.teamId,
  };

  if (!email || !fullName || !password) {
    return { status: "STOP_INVALID_ROW", email, state };
  }

  const existingProfile = await findProfileByEmail(email);
  if (existingProfile) {
    return {
      status: "STOP_PROFILE_EXISTS",
      email,
      profile_id: existingProfile.id,
      note: "No password reset / no overwrite",
      state,
    };
  }

  const existingAuth = await findAuthByEmail(email);
  if (existingAuth) {
    return {
      status: "STOP_AUTH_EXISTS_WITHOUT_PROFILE",
      email,
      auth_id: existingAuth.id,
      note: "No password reset / no Auth delete / no silent adopt",
      state,
    };
  }

  if (input.dryRun) {
    return {
      status: "DRY_RUN_WOULD_CREATE",
      email,
      full_name: fullName,
      state,
    };
  }

  try {
    let authUser;
    try {
      authUser = await createAuthUser(email, password);
    } catch (err) {
      if (isAuthAlreadyExistsError(err)) {
        return {
          status: "STOP_AUTH_EXISTS_WITHOUT_PROFILE",
          email,
          note: "createUser reported existing; no compensating delete",
          state,
        };
      }
      throw err;
    }
    state.authCreated = true;
    state.authId = authUser.id;

    const profile = await createProfile({
      id: authUser.id,
      email,
      full_name: fullName,
      organization_id: input.orgId,
    });
    state.profileCreated = true;
    state.profileId = profile.id;

    await createMembership(input.teamId, profile.id);
    state.membershipCreated = true;

    if (INTEGRATORS.has(email)) {
      for (const cap of INTEGRATOR_CAPS) {
        await createCapability(profile.id, cap);
        state.capabilitiesCreated.push(cap);
      }
    }

    return {
      status: "CREATED",
      email,
      auth_id: authUser.id,
      profile_created: true,
      team_member: true,
      integrators: INTEGRATORS.has(email),
      oziel_special:
        email === "oziel.hernandez@concasa.mx"
          ? "OZIEL_BASE_CREATED_SPECIAL_ACCESS_PENDING"
          : undefined,
      state,
    };
  } catch (err) {
    const comp = await compensate(state);
    if (!comp.ok) {
      return {
        status: "FAILED_COMPENSATION_INCOMPLETE",
        email,
        error: err.message || String(err),
        left: comp.left,
        state: {
          authCreated: state.authCreated,
          profileCreated: state.profileCreated,
          membershipCreated: state.membershipCreated,
          capabilitiesCreated: [...state.capabilitiesCreated],
          authId: state.authId,
          profileId: state.profileId,
        },
      };
    }
    return {
      status: "FAILED_ROLLED_BACK",
      email,
      error: err.message || String(err),
      state,
    };
  }
}

function buildLiveDeps(sb) {
  return {
    async findProfileByEmail(email) {
      const { data, error } = await sb
        .from("profiles")
        .select("id,email,app_role,active,organization_id,full_name")
        .eq("email", email)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async findAuthByEmail(email) {
      // Prefer get by filter; if Admin list is degraded, return null and rely on createUser.
      try {
        const { data, error } = await sb.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        if (error) return null;
        const hit = (data?.users || []).find(
          (u) => (u.email || "").toLowerCase() === email,
        );
        return hit || null;
      } catch {
        return null;
      }
    },
    async createAuthUser(email, password) {
      const { data, error } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      return data.user;
    },
    async createProfile(row) {
      const { data, error } = await sb
        .from("profiles")
        .insert({
          id: row.id,
          email: row.email,
          full_name: row.full_name,
          app_role: "asesor",
          active: true,
          organization_id: row.organization_id,
          tipo_asesor_origen: "interno",
        })
        .select("id,email,app_role,active,organization_id,full_name")
        .single();
      if (error) throw error;
      return data;
    },
    async createMembership(teamId, asesorId) {
      const { error } = await sb.from("asesor_equipo_miembros").insert({
        team_id: teamId,
        asesor_id: asesorId,
        active: true,
      });
      if (error) throw error;
    },
    async createCapability(profileId, capability) {
      const { error } = await sb.from("profile_capabilities").insert({
        profile_id: profileId,
        capability,
        active: true,
      });
      if (error) throw error;
    },
    async compensate(state) {
      return compensateUserCreates(
        {
          async deleteCapability(profileId, capability) {
            const { error } = await sb
              .from("profile_capabilities")
              .delete()
              .eq("profile_id", profileId)
              .eq("capability", capability);
            if (error) throw error;
          },
          async deleteMembership(teamId, asesorId) {
            const { error } = await sb
              .from("asesor_equipo_miembros")
              .delete()
              .eq("team_id", teamId)
              .eq("asesor_id", asesorId);
            if (error) throw error;
          },
          async deleteProfile(profileId) {
            const { error } = await sb
              .from("profiles")
              .delete()
              .eq("id", profileId);
            if (error) throw error;
          },
          async deleteAuthUser(id) {
            const { error } = await sb.auth.admin.deleteUser(id);
            if (error) throw error;
          },
        },
        state,
      );
    },
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const usersFile = process.env.TEAM_SILVIA_USERS_FILE;
  const dryRun = process.env.TEAM_SILVIA_DRY_RUN === "1";
  const leaderEmail = (
    process.env.TEAM_SILVIA_LEADER_EMAIL || "silvia.reyes@concasa.mx"
  ).toLowerCase();

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

  const deps = buildLiveDeps(sb);

  console.log(
    JSON.stringify({
      dry_run: dryRun,
      leader_email: leaderEmail,
      users_planned: users.map(redactUserRow),
      oziel_note: "OZIEL_BASE_CREATED_SPECIAL_ACCESS_PENDING",
    }),
  );

  const leader = await deps.findProfileByEmail(leaderEmail);
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
    const result = await provisionOneUser(deps, {
      ...u,
      orgId,
      teamId,
      dryRun,
    });
    report.push(result);

    if (result.status === "FAILED_COMPENSATION_INCOMPLETE") {
      console.log(
        JSON.stringify({
          abort: "FAILED_COMPENSATION_INCOMPLETE",
          email: result.email,
          left: result.left,
          report,
        }),
      );
      process.exit(2);
    }
  }

  if (!dryRun) {
    // Leader cap: idempotent; never compensate (may preexist).
    const { data: existingCap } = await sb
      .from("profile_capabilities")
      .select("capability")
      .eq("profile_id", leader.id)
      .eq("capability", "team_dashboard_read")
      .maybeSingle();
    if (!existingCap) {
      await sb.from("profile_capabilities").insert({
        profile_id: leader.id,
        capability: "team_dashboard_read",
        active: true,
      });
    }
  }

  console.log(JSON.stringify({ report }, null, 2));
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
