import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTO_PRECAL_PRIORITY_ZERO_ATTEMPT_MIN_AGE_MS,
  selectAutoPrecalRetryCandidates,
} from "./auto-precal-retry";

describe("auto-precal prioridad cero intentos", () => {
  const nowMs = Date.parse("2026-09-14T20:20:00.000Z");

  it("prioritario entra a los 2 minutos aunque el normal espere 10", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["anette", "normal"],
      intentos: [],
      pendingSinceById: {
        anette: "2026-09-14T20:18:00.000Z",
        normal: "2026-09-14T20:00:00.000Z",
      },
      priorityExpedienteIds: ["anette"],
      nowMs,
      limit: 2,
    });

    assert.equal(AUTO_PRECAL_PRIORITY_ZERO_ATTEMPT_MIN_AGE_MS, 2 * 60 * 1000);
    assert.deepEqual(ids, ["anette", "normal"]);
  });

  it("prioritario con menos de 2 minutos todavía no entra", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["anette"],
      intentos: [],
      pendingSinceById: {
        anette: "2026-09-14T20:18:01.000Z",
      },
      priorityExpedienteIds: ["anette"],
      nowMs,
    });

    assert.deepEqual(ids, []);
  });

  it("normal conserva la red de seguridad de 10 minutos", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["normal"],
      intentos: [],
      pendingSinceById: {
        normal: "2026-09-14T20:17:00.000Z",
      },
      nowMs,
    });

    assert.deepEqual(ids, []);
  });
});
