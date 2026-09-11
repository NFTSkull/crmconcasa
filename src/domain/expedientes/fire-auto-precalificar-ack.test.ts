import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fireAutoPrecalificarAck } from "./fire-auto-precalificar-ack";

describe("fireAutoPrecalificarAck", () => {
  it("POST con Bearer y await del ack 202", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, status: "accepted" }), {
        status: 202,
      });
    }) as typeof fetch;

    const result = await fireAutoPrecalificarAck({
      expedienteId: "11111111-1111-4111-8111-111111111111",
      accessToken: "tok-fresh",
      fetchImpl,
      timeoutMs: 1000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
    assert.equal(calls.length, 1);
    assert.match(
      calls[0]!.url,
      /\/api\/precalificaciones\/11111111-1111-4111-8111-111111111111\/auto-precalificar$/,
    );
    const headers = calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer tok-fresh");
  });

  it("no llama fetch si falta accessToken", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("nope", { status: 401 });
    }) as typeof fetch;

    const result = await fireAutoPrecalificarAck({
      expedienteId: "11111111-1111-4111-8111-111111111111",
      accessToken: null,
      fetchImpl,
    });

    assert.equal(result.ok, false);
    assert.equal(called, false);
  });
});
