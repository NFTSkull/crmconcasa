import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { autoPrecalAcceptedResponse } from "@/app/api/precalificaciones/[id]/auto-precalificar/route";

describe("auto-precalificar HTTP ack", () => {
  it("autoPrecalAcceptedResponse → 202 + status accepted", async () => {
    const id = "59e41939-51cd-4742-a0ac-7c7d55d02fbe";
    const res = autoPrecalAcceptedResponse(id);
    assert.equal(res.status, 202);
    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      expediente_id: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.status, "accepted");
    assert.equal(body.expediente_id, id);
  });
});
