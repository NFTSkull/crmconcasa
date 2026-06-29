import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatEnMesaHaceLabel,
  getMesaEnvioSortTimestamp,
  resolveMesaEnvioIso,
  sortMesaBandejaPorAntiguedad,
} from "./mesaBandejaOrden";

describe("getMesaEnvioSortTimestamp", () => {
  it("prioriza fechaEnvioMesa sobre createdAt", () => {
    const t = getMesaEnvioSortTimestamp({
      fechaEnvioMesa: "2026-06-01T10:00:00.000Z",
      createdAt: "2026-06-10T10:00:00.000Z",
    });
    assert.equal(t, new Date("2026-06-01T10:00:00.000Z").getTime());
  });

  it("sin fecha válida va al final", () => {
    assert.equal(getMesaEnvioSortTimestamp({}), Number.POSITIVE_INFINITY);
  });
});

describe("sortMesaBandejaPorAntiguedad", () => {
  it("ordena más viejos primero", () => {
    const items = [
      { id: "nuevo", fechaEnvioMesa: "2026-06-20T00:00:00.000Z" },
      { id: "viejo", fechaEnvioMesa: "2026-06-01T00:00:00.000Z" },
      { id: "medio", fechaEnvioMesa: "2026-06-10T00:00:00.000Z" },
    ];
    const sorted = sortMesaBandejaPorAntiguedad(items);
    assert.deepEqual(
      sorted.map((x) => x.id),
      ["viejo", "medio", "nuevo"],
    );
  });

  it("no muta el arreglo original", () => {
    const items = [
      { fechaEnvioMesa: "2026-06-02T00:00:00.000Z" },
      { fechaEnvioMesa: "2026-06-01T00:00:00.000Z" },
    ];
    const copy = [...items];
    sortMesaBandejaPorAntiguedad(items);
    assert.deepEqual(items, copy);
  });
});

describe("resolveMesaEnvioIso", () => {
  it("prioriza fechaEnvioMesa sobre createdAt", () => {
    assert.equal(
      resolveMesaEnvioIso("2026-06-01T00:00:00.000Z", "2026-06-10T00:00:00.000Z"),
      "2026-06-01T00:00:00.000Z",
    );
  });
});

describe("formatEnMesaHaceLabel", () => {
  const now = new Date("2026-06-25T14:00:00.000Z");

  it("fallback createdAt", () => {
    assert.equal(
      formatEnMesaHaceLabel(null, now, "2026-06-23T14:00:00.000Z"),
      "En Mesa hace 2 días",
    );
  });

  it("minutos", () => {
    assert.equal(
      formatEnMesaHaceLabel("2026-06-25T13:30:00.000Z", now),
      "En Mesa hace 30 min",
    );
  });

  it("horas", () => {
    assert.equal(
      formatEnMesaHaceLabel("2026-06-25T10:00:00.000Z", now),
      "En Mesa hace 4 h",
    );
  });

  it("días", () => {
    assert.equal(
      formatEnMesaHaceLabel("2026-06-23T14:00:00.000Z", now),
      "En Mesa hace 2 días",
    );
  });

  it("sin fecha", () => {
    assert.equal(formatEnMesaHaceLabel(null, now), null);
  });
});
