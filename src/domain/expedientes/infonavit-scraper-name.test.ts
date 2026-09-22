import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeInfonavitScraperPersonName } from "./infonavit-scraper-name";

describe("normalizeInfonavitScraperPersonName", () => {
  it("convierte # del scraper a Ñ", () => {
    assert.equal(
      normalizeInfonavitScraperPersonName("MORENO PI#A ALAN ANTOVELI"),
      "MORENO PIÑA ALAN ANTOVELI",
    );
    assert.equal(
      normalizeInfonavitScraperPersonName("MU#OZ MURILLO CARLOS GUADALUPE"),
      "MUÑOZ MURILLO CARLOS GUADALUPE",
    );
  });

  it("convierte nombres mixtos a mayúsculas conservando acentos", () => {
    assert.equal(
      normalizeInfonavitScraperPersonName("García de la Cruz Ana María"),
      "GARCÍA DE LA CRUZ ANA MARÍA",
    );
  });

  it("conserva Ñ/acentos/guion/apóstrofe válidos", () => {
    assert.equal(
      normalizeInfonavitScraperPersonName("PEÑA O'CONNOR ANA-MARÍA"),
      "PEÑA O'CONNOR ANA-MARÍA",
    );
  });

  it("rechaza símbolos inesperados después de normalizar", () => {
    assert.equal(normalizeInfonavitScraperPersonName("JUAN @ PEREZ"), null);
    assert.equal(normalizeInfonavitScraperPersonName(""), null);
  });
});
