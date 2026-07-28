import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandIngresosVisibleStepToEtapas,
  expandIngresosFromStepToEtapas,
} from "./stage-map";

describe("P137 ingresos stage map", () => {
  it("paso 3 → internas 3 y 4", () => {
    assert.deepEqual(expandIngresosVisibleStepToEtapas(3), [3, 4]);
  });

  it("paso 4 → interna 5; paso 7 → 8; paso 11 → 12", () => {
    assert.deepEqual(expandIngresosVisibleStepToEtapas(4), [5]);
    assert.deepEqual(expandIngresosVisibleStepToEtapas(7), [8]);
    assert.deepEqual(expandIngresosVisibleStepToEtapas(11), [12]);
  });

  it("from_step 4 excluye 1–3 visibles (internas 1–4)", () => {
    const etapas = expandIngresosFromStepToEtapas(4);
    assert.ok(!etapas.includes(1));
    assert.ok(!etapas.includes(2));
    assert.ok(!etapas.includes(3));
    assert.ok(!etapas.includes(4));
    assert.ok(etapas.includes(5));
    assert.ok(etapas.includes(12));
  });

  it("from_step 1 cubre todas las internas 1–12", () => {
    assert.deepEqual(expandIngresosFromStepToEtapas(1), [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("from_step 8 incluye 9–12", () => {
    assert.deepEqual(expandIngresosFromStepToEtapas(8), [9, 10, 11, 12]);
  });
});
