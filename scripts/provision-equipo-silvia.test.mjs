import test from "node:test";
import assert from "node:assert/strict";
import {
  compensateUserCreates,
  isAuthAlreadyExistsError,
  provisionOneUser,
  INTEGRATOR_CAPS,
} from "./provision-equipo-silvia.mjs";

function makeTracker() {
  const store = {
    auth: new Map(),
    profiles: new Map(),
    memberships: new Set(),
    caps: new Set(),
  };
  const keyMem = (t, a) => `${t}:${a}`;
  const keyCap = (p, c) => `${p}:${c}`;

  const deps = {
    store,
    async findProfileByEmail(email) {
      for (const p of store.profiles.values()) {
        if (p.email === email) return p;
      }
      return null;
    },
    async findAuthByEmail(email) {
      for (const u of store.auth.values()) {
        if (u.email === email) return u;
      }
      return null;
    },
    async createAuthUser(email, _password) {
      if ([...store.auth.values()].some((u) => u.email === email)) {
        const err = new Error("User already registered");
        err.status = 422;
        throw err;
      }
      const id = `auth-${store.auth.size + 1}`;
      const user = { id, email };
      store.auth.set(id, user);
      return user;
    },
    async createProfile(row) {
      if (store.profiles.has(row.id)) throw new Error("profile exists");
      const p = { ...row };
      store.profiles.set(row.id, p);
      return p;
    },
    async createMembership(teamId, asesorId) {
      if (deps._failMembership) throw new Error("membership boom");
      store.memberships.add(keyMem(teamId, asesorId));
    },
    async createCapability(profileId, capability) {
      if (
        deps._failCapabilityOn &&
        deps._failCapabilityOn === capability
      ) {
        throw new Error(`capability boom ${capability}`);
      }
      store.caps.add(keyCap(profileId, capability));
    },
    async compensate(state) {
      return compensateUserCreates(
        {
          async deleteCapability(profileId, capability) {
            store.caps.delete(keyCap(profileId, capability));
          },
          async deleteMembership(teamId, asesorId) {
            store.memberships.delete(keyMem(teamId, asesorId));
          },
          async deleteProfile(profileId) {
            store.profiles.delete(profileId);
          },
          async deleteAuthUser(id) {
            store.auth.delete(id);
          },
        },
        state,
      );
    },
    _failMembership: false,
    _failCapabilityOn: null,
  };
  return deps;
}

test("A) membership falla → rollback Auth+profile+membership+caps", async () => {
  const deps = makeTracker();
  deps._failMembership = true;
  const out = await provisionOneUser(deps, {
    email: "julieta.gonzalez@concasa.mx",
    full_name: "Julieta",
    password: "x",
    orgId: "org",
    teamId: "team",
  });
  assert.equal(out.status, "FAILED_ROLLED_BACK");
  assert.equal(deps.store.auth.size, 0);
  assert.equal(deps.store.profiles.size, 0);
  assert.equal(deps.store.memberships.size, 0);
  assert.equal(deps.store.caps.size, 0);
});

test("B) capability #2 falla → rollback completo incl. cap #1", async () => {
  const deps = makeTracker();
  deps._failCapabilityOn = INTEGRATOR_CAPS[1];
  const out = await provisionOneUser(deps, {
    email: "adriana.reyes@concasa.mx",
    full_name: "Adriana",
    password: "x",
    orgId: "org",
    teamId: "team",
  });
  assert.equal(out.status, "FAILED_ROLLED_BACK");
  assert.equal(deps.store.auth.size, 0);
  assert.equal(deps.store.profiles.size, 0);
  assert.equal(deps.store.memberships.size, 0);
  assert.equal(deps.store.caps.size, 0);
});

test("C) profile preexistente: no create / no delete / no reset", async () => {
  const deps = makeTracker();
  deps.store.profiles.set("pre", {
    id: "pre",
    email: "hector.nunez@concasa.mx",
  });
  let createdAuth = false;
  const orig = deps.createAuthUser;
  deps.createAuthUser = async (...args) => {
    createdAuth = true;
    return orig(...args);
  };
  const out = await provisionOneUser(deps, {
    email: "hector.nunez@concasa.mx",
    full_name: "Hector",
    password: "x",
    orgId: "org",
    teamId: "team",
  });
  assert.equal(out.status, "STOP_PROFILE_EXISTS");
  assert.equal(createdAuth, false);
  assert.equal(deps.store.profiles.size, 1);
  assert.equal(deps.store.auth.size, 0);
});

test("D) Auth preexistente sin profile: STOP, no delete", async () => {
  const deps = makeTracker();
  deps.store.auth.set("a1", {
    id: "a1",
    email: "oziel.hernandez@concasa.mx",
  });
  const out = await provisionOneUser(deps, {
    email: "oziel.hernandez@concasa.mx",
    full_name: "Oziel",
    password: "x",
    orgId: "org",
    teamId: "team",
  });
  assert.equal(out.status, "STOP_AUTH_EXISTS_WITHOUT_PROFILE");
  assert.equal(deps.store.auth.size, 1);
  assert.equal(deps.store.profiles.size, 0);
});

test("D2) createUser already-registered → STOP sin compensating delete", async () => {
  const deps = makeTracker();
  deps.findAuthByEmail = async () => null;
  deps.createAuthUser = async () => {
    const err = new Error("User already registered");
    err.status = 422;
    throw err;
  };
  let deleted = false;
  const baseCompensate = deps.compensate;
  deps.compensate = async (state) => {
    deleted = true;
    return baseCompensate(state);
  };
  const out = await provisionOneUser(deps, {
    email: "alonso.medina@concasa.mx",
    full_name: "Alonso",
    password: "x",
    orgId: "org",
    teamId: "team",
  });
  assert.equal(out.status, "STOP_AUTH_EXISTS_WITHOUT_PROFILE");
  assert.equal(deleted, false);
  assert.equal(isAuthAlreadyExistsError({ status: 422, message: "x" }), true);
});

test("compensation incomplete aborts with left objects", async () => {
  const state = {
    email: "x@y.z",
    authCreated: true,
    authId: "a",
    profileCreated: true,
    profileId: "p",
    membershipCreated: true,
    teamId: "t",
    capabilitiesCreated: ["create_for_any_advisor"],
  };
  const out = await compensateUserCreates(
    {
      async deleteCapability() {
        throw new Error("cap stuck");
      },
      async deleteMembership() {},
      async deleteProfile() {},
      async deleteAuthUser() {},
    },
    state,
  );
  assert.equal(out.ok, false);
  assert.deepEqual(out.left, ["capability:create_for_any_advisor"]);
});
