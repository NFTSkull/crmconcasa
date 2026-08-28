import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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

describe("selectAutoPrecalRetryCandidates", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");
  const old = "2026-08-28T11:00:00.000Z"; // 60 min ago
  const recent = "2026-08-28T11:55:00.000Z"; // 5 min ago

  it("excluye backlog sin ningún intento auto-precal", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa", "bbbb"],
      intentos: [],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
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

  it("incluye pendiente con scraper_failed, <3 intentos, último ≥10 min", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [intento("aaaa", old, "pending_error", "scraper_failed")],
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("excluye si último intento < 10 min", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", recent, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("excluye si ya tiene 3+ intentos totales", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: ["aaaa"],
      intentos: [
        intento("aaaa", "2026-08-28T09:00:00.000Z", "pending_error", "scraper_failed"),
        intento("aaaa", "2026-08-28T10:00:00.000Z", "pending_error", "scraper_failed"),
        intento("aaaa", old, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("exige decisión pendiente: id con intentos pero no en pendingExpedienteIds", () => {
    const ids = selectAutoPrecalRetryCandidates({
      pendingExpedienteIds: [],
      intentos: [intento("aaaa", old, "pending_error", "scraper_failed")],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("limita a 5 y prioriza el último intento más antiguo", () => {
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
      limit: 5,
    });
    assert.deepEqual(ids, ["e6", "e5", "e4", "e3", "e2"]);
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
});
