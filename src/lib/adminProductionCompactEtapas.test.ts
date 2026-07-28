import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compactEtapasProduccion } from "@/lib/adminProductionCompactEtapas";

describe("compactEtapasProduccion (P135)", () => {
  it("incluye Notificación cuando hay expedientes en etapa 7", () => {
    const text = compactEtapasProduccion({
      "1": 5,
      "2": 7,
      "3": 4,
      "4": 5,
      "5": 1,
      "7": 1,
      "8": 1,
      "9": 7,
    });
    assert.match(text, /Integración 12/);
    assert.match(text, /Biométricos 10/);
    assert.match(text, /Notificación 1/);
    assert.match(text, /Pendiente Acuse 1/);
    assert.match(text, /Firma 7/);
    const nums = [...text.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
    assert.equal(
      nums.reduce((a, b) => a + b, 0),
      31,
      "categorías compactas suman 31",
    );
  });

  it("oculta Notificación cuando n=0", () => {
    const text = compactEtapasProduccion({ "1": 2, "8": 1 });
    assert.doesNotMatch(text, /Notificación/);
    assert.match(text, /Integración 2/);
    assert.match(text, /Pendiente Acuse 1/);
  });

  it("no inventa categorías vacías", () => {
    assert.equal(compactEtapasProduccion({}), "—");
  });
});
