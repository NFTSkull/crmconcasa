import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkInclusiveDateRange,
  resolveBernardoPeriodBounds,
  bernardoPeriodDisplayLabel,
} from "@/lib/adminBernardoPeriod";

describe("Admin UX B3 — periodos Bernardo", () => {
  const now = new Date("2026-08-05T18:00:00.000Z"); // miércoles en Monterrey

  it("Hoy es el periodo inicial completo del día", () => {
    const b = resolveBernardoPeriodBounds({ preset: "hoy", now });
    assert.equal(b.fromDate, "2026-08-05");
    assert.equal(b.toDateInclusive, "2026-08-05");
    assert.equal(b.preset, "hoy");
  });

  it("Esta semana cubre lunes a domingo", () => {
    const b = resolveBernardoPeriodBounds({ preset: "semana", now });
    assert.equal(b.fromDate, "2026-08-03"); // lunes
    assert.equal(b.toDateInclusive, "2026-08-09"); // domingo
  });

  it("Este mes cubre el mes calendario completo", () => {
    const b = resolveBernardoPeriodBounds({ preset: "mes", now });
    assert.equal(b.fromDate, "2026-08-01");
    assert.equal(b.toDateInclusive, "2026-08-31");
  });

  it("Mes pasado cubre el mes calendario anterior completo", () => {
    const b = resolveBernardoPeriodBounds({ preset: "mes_pasado", now });
    assert.equal(b.fromDate, "2026-07-01");
    assert.equal(b.toDateInclusive, "2026-07-31");
  });

  it("Personalizado usa from/to inclusivos", () => {
    const b = resolveBernardoPeriodBounds({
      preset: "personalizado",
      customFrom: "2026-07-10",
      customToInclusive: "2026-07-12",
      now,
    });
    assert.equal(b.fromDate, "2026-07-10");
    assert.equal(b.toDateInclusive, "2026-07-12");
    assert.match(bernardoPeriodDisplayLabel(b), /2026-07-10 al 2026-07-12/);
  });

  it("Personalizado inválido lanza", () => {
    assert.throws(() =>
      resolveBernardoPeriodBounds({
        preset: "personalizado",
        customFrom: "",
        customToInclusive: "2026-07-12",
        now,
      }),
    );
  });

  it("chunkInclusiveDateRange respeta el límite de 62 días", () => {
    const chunks = chunkInclusiveDateRange("2026-01-01", "2026-04-30", 62);
    assert.ok(chunks.length >= 2);
    assert.equal(chunks[0]?.startDate, "2026-01-01");
    assert.equal(chunks[chunks.length - 1]?.endDate, "2026-04-30");
    for (const c of chunks) {
      assert.ok(c.startDate <= c.endDate);
    }
  });
});
