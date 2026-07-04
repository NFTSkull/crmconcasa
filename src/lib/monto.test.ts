import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMontoAprobado } from "./monto";

describe("parseMontoAprobado — regresión parseo miles MX", () => {
  it("interpreta coma como separador de miles", () => {
    assert.equal(parseMontoAprobado("89,490"), 89490);
    assert.equal(parseMontoAprobado("17,710"), 17710);
    assert.equal(parseMontoAprobado("27,640"), 27640);
    assert.equal(parseMontoAprobado("4,870"), 4870);
  });

  it("interpreta punto como separador de miles (no decimal JS)", () => {
    assert.equal(parseMontoAprobado("89.490"), 89490);
    assert.equal(parseMontoAprobado("17.710"), 17710);
    assert.equal(parseMontoAprobado("27.640"), 27640);
    assert.equal(parseMontoAprobado("4.870"), 4870);
  });

  it("no confunde Number() nativo (bug histórico editor)", () => {
    assert.equal(Number("89.490"), 89.49);
    assert.notEqual(Number("89.490"), parseMontoAprobado("89.490"));
  });

  it("acepta decimales reales de 1-2 dígitos", () => {
    assert.equal(parseMontoAprobado("105605.50"), 105605.5);
    assert.equal(parseMontoAprobado("45000.75"), 45000.75);
    assert.equal(parseMontoAprobado("13000,5"), 13000.5);
    assert.equal(parseMontoAprobado("166,100.12"), 166100.12);
    assert.equal(parseMontoAprobado("166.100,12"), 166100.12);
  });

  it("rechaza símbolo de moneda (el input del editor no incluye $)", () => {
    assert.equal(parseMontoAprobado("$89,490.00"), null);
  });

  it("acepta enteros puros", () => {
    assert.equal(parseMontoAprobado("89490"), 89490);
    assert.equal(parseMontoAprobado("13000"), 13000);
  });
});
