import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  selectAutoReprecalRetryCandidates,
  type AutoReprecalIntentoRow,
} from "./auto-reprecal-retry";

function intento(
  intento_id: string,
  intentado_en: string,
  resultado: string,
  razon: string | null,
): AutoReprecalIntentoRow {
  return { intento_id, intentado_en, resultado, razon };
}

describe("selectAutoReprecalRetryCandidates", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");
  const old = "2026-08-28T11:00:00.000Z"; // 60 min ago
  const recent = "2026-08-28T11:57:00.000Z"; // 3 min ago (< 5 min)
  const exactlyFive = "2026-08-28T11:55:00.000Z"; // 5 min ago (límite inclusive)

  it("excluye backlog sin ningún intento auto-reprecal", () => {
    const ids = selectAutoReprecalRetryCandidates({
      pendingIntentoIds: ["aaaa", "bbbb"],
      intentos: [],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("excluye pending_error ambiguous_payload (no scraper_failed)", () => {
    const ids = selectAutoReprecalRetryCandidates({
      pendingIntentoIds: ["aaaa"],
      intentos: [
        intento("aaaa", old, "pending_error", "ambiguous_payload"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("incluye pendiente con scraper_failed, último ≥5 min", () => {
    const ids = selectAutoReprecalRetryCandidates({
      pendingIntentoIds: ["aaaa"],
      intentos: [intento("aaaa", old, "pending_error", "scraper_failed")],
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("incluye si último intento hace exactamente 5 min", () => {
    const ids = selectAutoReprecalRetryCandidates({
      pendingIntentoIds: ["aaaa"],
      intentos: [
        intento("aaaa", exactlyFive, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("excluye si último intento < 5 min", () => {
    const ids = selectAutoReprecalRetryCandidates({
      pendingIntentoIds: ["aaaa"],
      intentos: [
        intento("aaaa", recent, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("sigue siendo candidato con muchos intentos scraper_failed previos", () => {
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
    const ids = selectAutoReprecalRetryCandidates({
      pendingIntentoIds: ["aaaa"],
      intentos,
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });

  it("exige decisión pendiente: id con intentos pero no en pendingIntentoIds", () => {
    const ids = selectAutoReprecalRetryCandidates({
      pendingIntentoIds: [],
      intentos: [intento("aaaa", old, "pending_error", "scraper_failed")],
      nowMs: now,
    });
    assert.deepEqual(ids, []);
  });

  it("limita a 2 y prioriza el último intento más antiguo", () => {
    const pending = ["i1", "i2", "i3", "i4", "i5", "i6"];
    const intentos = [
      intento("i1", "2026-08-28T10:50:00.000Z", "pending_error", "scraper_failed"),
      intento("i2", "2026-08-28T10:40:00.000Z", "pending_error", "scraper_failed"),
      intento("i3", "2026-08-28T10:30:00.000Z", "pending_error", "scraper_failed"),
      intento("i4", "2026-08-28T10:20:00.000Z", "pending_error", "scraper_failed"),
      intento("i5", "2026-08-28T10:10:00.000Z", "pending_error", "scraper_failed"),
      intento("i6", "2026-08-28T10:00:00.000Z", "pending_error", "scraper_failed"),
    ];
    const ids = selectAutoReprecalRetryCandidates({
      pendingIntentoIds: pending,
      intentos,
      nowMs: now,
      limit: 2,
    });
    assert.deepEqual(ids, ["i6", "i5"]);
  });

  it("acepta candidato con historial mixed si hubo al menos un scraper_failed", () => {
    const ids = selectAutoReprecalRetryCandidates({
      pendingIntentoIds: ["aaaa"],
      intentos: [
        intento("aaaa", "2026-08-28T10:00:00.000Z", "pending_error", "ambiguous_payload"),
        intento("aaaa", old, "pending_error", "scraper_failed"),
      ],
      nowMs: now,
    });
    assert.deepEqual(ids, ["aaaa"]);
  });
});
