import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveBearerAccessToken } from "./resolve-bearer-access-token";

describe("resolveBearerAccessToken", () => {
  it("usa access_token de refreshSession cuando viene fresco", async () => {
    const token = await resolveBearerAccessToken(
      {
        refreshSession: async () => ({
          data: { session: { access_token: "fresh-tok" } },
          error: null,
        }),
        getSession: async () => ({
          data: { session: { access_token: "stale-tok" } },
        }),
      },
      "test",
    );
    assert.equal(token, "fresh-tok");
  });

  it("fallback a getSession si refresh no trae session", async () => {
    const token = await resolveBearerAccessToken(
      {
        refreshSession: async () => ({
          data: { session: null },
          error: { message: "transient" },
        }),
        getSession: async () => ({
          data: { session: { access_token: "cached-tok" } },
        }),
      },
      "test",
    );
    assert.equal(token, "cached-tok");
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
