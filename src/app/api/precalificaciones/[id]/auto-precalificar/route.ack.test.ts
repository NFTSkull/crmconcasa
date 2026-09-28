import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { autoPrecalAcceptedResponse } from "@/app/api/precalificaciones/[id]/auto-precalificar/route";

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

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

describe("auto-precalificar espera corta del lease (contrato)", () => {
  const route = readSrc(
    "src/app/api/precalificaciones/[id]/auto-precalificar/route.ts",
  );

  it("el job (con espera 10s) corre dentro de after() y el 202 no lo espera", () => {
    const afterIdx = route.indexOf("after(() =>");
    const jobIdx = route.indexOf("runAutoPrecalificarJob({", afterIdx);
    const waitIdx = route.indexOf("scraperBusyWaitMs: 10_000", jobIdx);
    const ackIdx = route.indexOf("return autoPrecalAcceptedResponse(");

    assert.ok(afterIdx >= 0, "falta after()");
    assert.ok(jobIdx > afterIdx, "el job debe invocarse dentro de after()");
    assert.ok(waitIdx > jobIdx, "la route debe pasar scraperBusyWaitMs: 10_000");
    assert.ok(ackIdx > waitIdx, "el 202 se devuelve después de agendar after()");
    assert.doesNotMatch(route, /await\s+runAutoPrecalificarJob/);
    assert.match(route, /export const maxDuration = 180;/);
  });

  it("solo la route HTTP inicial configura la espera", () => {
    const sinEspera = [
      "src/app/api/cron/reintentar-pendientes/route.ts",
      "src/app/api/cron/reintentar-pendientes-reprecal/route.ts",
      "src/app/api/precalificaciones/reprecalificacion/[intentoId]/auto-precalificar/route.ts",
      "src/domain/expedientes/auto-reprecalificar-job.ts",
    ];
    for (const rel of sinEspera) {
      const src = readSrc(rel);
      assert.doesNotMatch(src, /scraperBusyWaitMs/, rel);
      assert.doesNotMatch(src, /waitForAutoPrecalScraperLease/, rel);
    }
  });
});
