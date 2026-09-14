import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isBearerAccessTokenFresh,
  resolveBearerAccessToken,
} from "./resolve-bearer-access-token";

describe("isBearerAccessTokenFresh", () => {
  it("false sin token", () => {
    assert.equal(isBearerAccessTokenFresh(null, 1_000), false);
    assert.equal(isBearerAccessTokenFresh({ access_token: "  " }, 1_000), false);
  });

  it("true con token y sin expires_at", () => {
    assert.equal(
      isBearerAccessTokenFresh({ access_token: "tok" }, 1_000),
      true,
    );
  });

  it("respeta margen minTtlSec", () => {
    assert.equal(
      isBearerAccessTokenFresh(
        { access_token: "tok", expires_at: 1_000 + 119 },
        1_000,
        120,
      ),
      false,
    );
    assert.equal(
      isBearerAccessTokenFresh(
        { access_token: "tok", expires_at: 1_000 + 120 },
        1_000,
        120,
      ),
      true,
    );
  });
});

describe("resolveBearerAccessToken", () => {
  it("no llama refreshSession si el access_token local aún es vigente", async () => {
    let refreshCalls = 0;
    const token = await resolveBearerAccessToken(
      {
        refreshSession: async () => {
          refreshCalls += 1;
          return {
            data: { session: { access_token: "refreshed" } },
            error: null,
          };
        },
        getSession: async () => ({
          data: {
            session: {
              access_token: "local-fresh",
              expires_at: 2_000_000_000,
            },
          },
        }),
      },
      "test",
      { nowSec: 1_700_000_000 },
    );
    assert.equal(token, "local-fresh");
    assert.equal(refreshCalls, 0);
  });

  it("refresca si el token local está por vencer", async () => {
    let refreshCalls = 0;
    const nowSec = 1_700_000_000;
    const token = await resolveBearerAccessToken(
      {
        refreshSession: async () => {
          refreshCalls += 1;
          return {
            data: {
              session: {
                access_token: "fresh-tok",
                expires_at: nowSec + 3600,
              },
            },
            error: null,
          };
        },
        getSession: async () => ({
          data: {
            session: {
              access_token: "almost-dead",
              expires_at: nowSec + 30,
            },
          },
        }),
      },
      "test",
      { nowSec },
    );
    assert.equal(token, "fresh-tok");
    assert.equal(refreshCalls, 1);
  });

  it("refresca si no hay sesión local", async () => {
    const token = await resolveBearerAccessToken(
      {
        refreshSession: async () => ({
          data: { session: { access_token: "fresh-tok" } },
          error: null,
        }),
        getSession: async () => ({ data: { session: null } }),
      },
      "test",
    );
    assert.equal(token, "fresh-tok");
  });

  it("fallback a getSession si refresh no trae session", async () => {
    let getCalls = 0;
    const token = await resolveBearerAccessToken(
      {
        refreshSession: async () => ({
          data: { session: null },
          error: { message: "transient" },
        }),
        getSession: async () => {
          getCalls += 1;
          // 1ª: sin sesión (fuerza refresh); 2ª: fallback post-refresh
          if (getCalls === 1) return { data: { session: null } };
          return {
            data: {
              session: {
                access_token: "cached-tok",
                expires_at: 2_000_000_000,
              },
            },
          };
        },
      },
      "test",
      { nowSec: 1_700_000_000 },
    );
    assert.equal(token, "cached-tok");
  });

  it("Already Used: reintenta getSession y usa token local nuevo", async () => {
    let getCalls = 0;
    const token = await resolveBearerAccessToken(
      {
        refreshSession: async () => ({
          data: { session: null },
          error: {
            message: "Invalid Refresh Token: Already Used",
          },
        }),
        getSession: async () => {
          getCalls += 1;
          if (getCalls === 1) {
            return {
              data: {
                session: {
                  access_token: "almost-dead",
                  expires_at: 1_700_000_030,
                },
              },
            };
          }
          if (getCalls === 2) {
            // Fallback inmediato post-refresh: aún no llegó la sesión del otro refresh
            return { data: { session: null } };
          }
          return {
            data: {
              session: {
                access_token: "from-other-refresh",
                expires_at: 1_700_003_600,
              },
            },
          };
        },
      },
      "test",
      { nowSec: 1_700_000_000, alreadyUsedRetryMs: 5 },
    );
    assert.equal(token, "from-other-refresh");
    assert.equal(getCalls, 3);
  });

  it("null si ni refresh ni getSession dan token", async () => {
    const token = await resolveBearerAccessToken(
      {
        refreshSession: async () => ({
          data: { session: null },
          error: { message: "Invalid Refresh Token" },
        }),
        getSession: async () => ({ data: { session: null } }),
      },
      "test",
    );
    assert.equal(token, null);
  });
});
