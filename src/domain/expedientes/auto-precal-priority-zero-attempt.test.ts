import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTO_PRECAL_PRIORITY_ZERO_ATTEMPT_MIN_AGE_MS,
  AUTO_PRECAL_ZERO_ATTEMPT_MIN_AGE_MS,
  selectAutoPrecalRetryCandidates,
} from "./auto-precal-retry";

describe("auto-precal rescate cero intentos", () => {
  const nowMs = Date.parse("2026-09-21T22:30:12.000Z");

  it("cero intentos todavía no entra a los 19 segundos", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["anette"],
      intentos: [],
      pendingSinceById: {
        anette: "2026-09-21T22:29:53.000Z",
      },
      priorityExpedienteIds: ["anette"],
      nowMs,
    });

    assert.equal(AUTO_PRECAL_ZERO_ATTEMPT_MIN_AGE_MS, 20 * 1000);
    assert.equal(AUTO_PRECAL_PRIORITY_ZERO_ATTEMPT_MIN_AGE_MS, 20 * 1000);
    assert.deepEqual(ids, []);
  });

  it("cero intentos entra desde los 20 segundos", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["anette", "normal"],
      intentos: [],
      pendingSinceById: {
        anette: "2026-09-21T22:29:52.000Z",
        normal: "2026-09-21T22:29:51.000Z",
      },
      priorityExpedienteIds: ["anette"],
      nowMs,
      limit: 2,
    });

    assert.deepEqual(ids, ["anette", "normal"]);
  });

  it("job_started reciente conserva bloqueo de 2 minutos", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["anette"],
      intentos: [
        {
          expediente_id: "anette",
          intentado_en: "2026-09-21T22:29:52.000Z",
          resultado: "pending_error",
          razon: "job_started",
        },
      ],
      pendingSinceById: {
        anette: "2026-09-21T22:20:00.000Z",
      },
      priorityExpedienteIds: ["anette"],
      nowMs,
    });

    assert.deepEqual(ids, []);
  });

  it("scraper_failed reciente conserva su cooldown técnico", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["anette"],
      intentos: [
        {
          expediente_id: "anette",
          intentado_en: "2026-09-21T22:29:12.000Z",
          resultado: "pending_error",
          razon: "scraper_failed",
        },
      ],
      priorityExpedienteIds: ["anette"],
      nowMs,
    });

    assert.deepEqual(ids, []);
  });
});
