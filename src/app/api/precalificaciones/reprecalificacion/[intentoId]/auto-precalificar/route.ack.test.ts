import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { autoReprecalAcceptedResponse } from "@/app/api/precalificaciones/reprecalificacion/[intentoId]/auto-precalificar/route";

describe("auto-reprecalificar HTTP ack", () => {
  it("autoReprecalAcceptedResponse → 202 + intento_id", async () => {
    const id = "59e41939-51cd-4742-a0ac-7c7d55d02fbe";
    const res = autoReprecalAcceptedResponse(id);
    assert.equal(res.status, 202);
    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      intento_id: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.status, "accepted");
    assert.equal(body.intento_id, id);
  });
});
