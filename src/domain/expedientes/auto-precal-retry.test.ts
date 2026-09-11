import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  consecutiveScraperFailedStreak,
  cooldownMsForScraperFailedStreak,
  selectAutoPrecalRetryCandidates,
  type AutoPrecalIntentoRow,
} from "./auto-precal-retry";

function intento(
  expediente_id: string,
  intentado_en: string,
  resultado: string,
  razon: string | null,
): AutoPrecalIntentoRow {
  return { expediente_id, intentado_en, resultado, razon };
}

describe("consecutiveScraperFailedStreak / cooldown", () => {
  it("racha desde el más reciente; corta con otra razón", () => {
    const rows = [
      intento("a", "2026-08-28T11:00:00.000Z", "pending_error", "scraper_failed"),
      intento("a", "2026-08-28T10:50:00.000Z", "pending_error", "scraper_failed"),
      intento("a", "2026-08-28T10:40:00.000Z", "pending_error", "ambiguous_payload"),
      intento("a", "2026-08-28T10:30:00.000Z", "pending_error", "scraper_failed"),
    ];
    assert.equal(consecutiveScraperFailedStreak(rows), 2);
  });

  it("cooldown 5/15/30/60 según racha", () => {
    assert.equal(cooldownMsForScraperFailedStreak(0), 5 * 60 * 1000);
    assert.equal(cooldownMsForScraperFailedStreak(1), 5 * 60 * 1000);
    assert.equal(cooldownMsForScraperFailedStreak(2), 15 * 60 * 1000);
    assert.equal(cooldownMsForScraperFailedStreak(3), 30 * 60 * 1000);
    assert.equal(cooldownMsForScraperFailedStreak(4), 60 * 60 * 1000);
    assert.equal(cooldownMsForScraperFailedStreak(9), 60 * 60 * 1000);
  });
});

describe("selectAutoPrecalRetryCandidates", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");
  const old = "2026-08-28T11:00:00.000Z"; // 60 min ago
  const recent = "2026-08-28T11:57:00.000Z"; // 3 min ago (< 5 min)
  const exactlyFive = "2026-08-28T11:55:00.000Z"; // 5 min ago (límite inclusive)
  const tenMin = "2026-08-28T11:50:00.000Z"; // 10 min — < 15
  const fifteenMin = "2026-08-28T11:45:00.000Z"; // 15 min

  it("excluye cero intentos si no hay pendingSinceById", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa", "bbbb"],
      intentos: [],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("excluye cero intentos si pending_since < 10 min", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [],
      pendingSinceById: { aaaa: recent }, // 3 min
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("incluye cero intentos si pending_since ≥ 10 min", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [],
      pendingSinceById: { aaaa: "2026-08-28T11:50:00.000Z" }, // 10 min
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("mezcla scraper_failed y cero-intentos; prioriza ancla más vieja; limit 2", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["old-zero", "mid-fail", "new-zero"],
      intentos: [
        intento(
          "mid-fail",
          "2026-08-28T11:00:00.000Z",
          "pending_error",
          "scraper_failed",
        ),
      ],
      pendingSinceById: {
        "old-zero": "2026-08-28T10:00:00.000Z",
        "new-zero": "2026-08-28T11:45:00.000Z", // 15 min — entra
      },
      nowMs: now,
      limit: 2,
    });
    // old-zero (10:00) luego mid-fail (11:00); new-zero queda fuera por limit
    assert.deepEqual(ids, ["old-zero", "mid-fail"]);
  });

  it("excluye pending_error ambiguous_payload (no scraper_failed)", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", old, "pending_error", "ambiguous_payload"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("incluye pendiente con scraper_failed, último ≥5 min", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [intento("aaaa", old, "pending_error", "scraper_failed")],
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("incluye si último intento hace exactamente 5 min (racha 1)", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", exactlyFive, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("excluye si último intento < 5 min", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", recent, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("racha 2: excluye si último hace 10 min (< 15)", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", "2026-08-28T11:40:00.000Z", "pending_error", "scraper_failed"),
        intento("aaaa", tenMin, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("racha 2: incluye si último hace ≥15 min", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", "2026-08-28T11:30:00.000Z", "pending_error", "scraper_failed"),
        intento("aaaa", fifteenMin, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("racha 4+: exige ≥60 min; a 30 min queda fuera", () => {
    const thirty = "2026-08-28T11:30:00.000Z";
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", "2026-08-28T10:00:00.000Z", "pending_error", "scraper_failed"),
        intento("aaaa", "2026-08-28T10:20:00.000Z", "pending_error", "scraper_failed"),
        intento("aaaa", "2026-08-28T10:40:00.000Z", "pending_error", "scraper_failed"),
        intento("aaaa", thirty, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("backoff deja pasar a otro expediente del backlog (limit 1)", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["hot", "other"],
      intentos: [
        // hot: racha 3, último hace 20 min → cooldown 30 → excluido
        intento("hot", "2026-08-28T11:00:00.000Z", "pending_error", "scraper_failed"),
        intento("hot", "2026-08-28T11:20:00.000Z", "pending_error", "scraper_failed"),
        intento("hot", "2026-08-28T11:40:00.000Z", "pending_error", "scraper_failed"),
        // other: racha 1, hace 60 min
        intento("other", old, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, ["other"]);
  });

  it("sigue siendo candidato con muchos intentos scraper_failed si ya pasaron 60 min", () => {
    const intentos = Array.from({ length: 12 }, (_, i) =>
      intento(
        "aaaa",
        `2026-08-28T${String(8 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00.000Z`,
        "pending_error",
        "scraper_failed",
      ),
    );
    intentos[intentos.length - 1] = intento(
      "aaaa",
      old,
      "pending_error",
      "scraper_failed",
    );
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos,
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("exige decisión pendiente: id con intentos pero no en pendingExpedienteIds", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: [],
      intentos: [intento("aaaa", old, "pending_error", "scraper_failed")],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("default limit=1: solo el ancla más antigua", () => {
    const pending = ["e1", "e2", "e3"];
    const intentos = [
      intento("e1", "2026-08-28T10:50:00.000Z", "pending_error", "scraper_failed"),
      intento("e2", "2026-08-28T10:40:00.000Z", "pending_error", "scraper_failed"),
      intento("e3", "2026-08-28T10:30:00.000Z", "pending_error", "scraper_failed"),
    ];
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: pending,
      intentos,
      nowMs: now,
    });
    assert.deepEqual(ids, ["e3"]);
  });

  it("limita a 2 (explícito) y prioriza el último intento más antiguo", () => {
    const pending = ["e1", "e2", "e3", "e4", "e5", "e6"];
    const intentos = [
      intento("e1", "2026-08-28T10:50:00.000Z", "pending_error", "scraper_failed"),
      intento("e2", "2026-08-28T10:40:00.000Z", "pending_error", "scraper_failed"),
      intento("e3", "2026-08-28T10:30:00.000Z", "pending_error", "scraper_failed"),
      intento("e4", "2026-08-28T10:20:00.000Z", "pending_error", "scraper_failed"),
      intento("e5", "2026-08-28T10:10:00.000Z", "pending_error", "scraper_failed"),
      intento("e6", "2026-08-28T10:00:00.000Z", "pending_error", "scraper_failed"),
    ];
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: pending,
      intentos,
      nowMs: now,
      limit: 2,
    });
    assert.deepEqual(ids, ["e6", "e5"]);
  });

  it("acepta candidato con historial mixed si hubo al menos un scraper_failed", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", "2026-08-28T10:00:00.000Z", "pending_error", "ambiguous_payload"),
        intento("aaaa", old, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("incluye pending_error + infonavit_system_error", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", old, "pending_error", "infonavit_system_error"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("excluye no_cumple (no reintento automático)", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [intento("aaaa", old, "no_cumple", null)],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("excluye pending_error + invalid_saldo / programa_desconocido", () => {
    for (const razon of ["invalid_saldo", "programa_desconocido"]) {
      const ids = selectAutoPrecalRetryCandidates({
        pendingExpedienteIds: ["aaaa"],
        intentos: [intento("aaaa", old, "pending_error", razon)],
        nowMs: now,
      });
      assert.deepEqual(ids, [], razon);
    }
  });

  it("prioridad: elegible prioritario gana a uno más viejo sin prioridad", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["old-plain", "new-priority"],
      intentos: [
        intento(
          "old-plain",
          "2026-08-28T10:00:00.000Z",
          "pending_error",
          "scraper_failed",
        ),
        intento(
          "new-priority",
          "2026-08-28T11:00:00.000Z",
          "pending_error",
          "scraper_failed",
        ),
      ],
      priorityExpedienteIds: ["new-priority"],
      nowMs: now,
      limit: 1,
    });
    assert.deepEqual(ids, ["new-priority"]);
  });

  it("sin priorityExpedienteIds: orden solo por antigüedad (igual que hoy)", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["old-plain", "new-priority"],
      intentos: [
        intento(
          "old-plain",
          "2026-08-28T10:00:00.000Z",
          "pending_error",
          "scraper_failed",
        ),
        intento(
          "new-priority",
          "2026-08-28T11:00:00.000Z",
          "pending_error",
          "scraper_failed",
        ),
      ],
      nowMs: now,
      limit: 1,
    });
    assert.deepEqual(ids, ["old-plain"]);
  });

  it("prioridad no salta cooldown: prioritario reciente cede al viejo elegible", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["old-plain", "hot-priority"],
      intentos: [
        intento(
          "old-plain",
          "2026-08-28T10:00:00.000Z",
          "pending_error",
          "scraper_failed",
        ),
        intento(
          "hot-priority",
          recent,
          "pending_error",
          "scraper_failed",
        ),
      ],
      priorityExpedienteIds: ["hot-priority"],
      nowMs: now,
      limit: 1,
    });
    assert.deepEqual(ids, ["old-plain"]);
  });
});
