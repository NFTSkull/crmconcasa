import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fireAutoReprecalificarAck } from "./fire-auto-reprecalificar-ack";

describe("fireAutoReprecalificarAck", () => {
  it("POST al endpoint con Bearer y await del ack", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, status: "accepted" }), {
        status: 202,
      });
    }) as typeof fetch;

    const result = await fireAutoReprecalificarAck({
      intentoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      accessToken: "tok-test",
      fetchImpl,
      timeoutMs: 1000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
    assert.equal(calls.length, 1);
    assert.match(
      calls[0]!.url,
      /\/api\/precalificaciones\/reprecalificacion\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\/auto-precalificar$/,
    );
    assert.equal(calls[0]!.init?.method, "POST");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer tok-test");
  });
});
