import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_COVERAGE,
  CARTA_COVERAGE,
  PRESUPUESTO_COVERAGE,
  SOLICITUD_COVERAGE,
} from "./p189-field-coverage.ts";
import {
  BAJO_PROTESTA_CONTRACT,
  PRESUPUESTO_CONTRACT,
  SOLICITUD_CONTRACT,
} from "./template-contract.ts";

function names(rows: { acroForm: string }[]): string[] {
  return [...new Set(rows.map((r) => r.acroForm))].sort();
}

describe("P189 matriz de cobertura vs contrato de plantilla", () => {
  it("Carta cubre exactamente los 10 AcroForm", () => {
    assert.equal(CARTA_COVERAGE.length, 10);
    assert.deepEqual(
      names(CARTA_COVERAGE),
      BAJO_PROTESTA_CONTRACT.expectedFields.map((f) => f.name).sort(),
    );
  });

  it("Presupuesto cubre exactamente los 12 AcroForm", () => {
    assert.equal(PRESUPUESTO_COVERAGE.length, 12);
    assert.deepEqual(
      names(PRESUPUESTO_COVERAGE),
      PRESUPUESTO_CONTRACT.expectedFields.map((f) => f.name).sort(),
    );
  });

  it("Solicitud cubre exactamente textos+checks del contrato", () => {
    assert.equal(SOLICITUD_COVERAGE.length, SOLICITUD_CONTRACT.expectedFields.length);
    assert.deepEqual(
      names(SOLICITUD_COVERAGE),
      SOLICITUD_CONTRACT.expectedFields.map((f) => f.name).sort(),
    );
  });

  it("ningún campo clasificado como inventado (no existe F)", () => {
    for (const row of ALL_COVERAGE) {
      assert.ok(
        row.category === "A" ||
          row.category === "B" ||
          row.category === "C" ||
          row.category === "D" ||
          row.category === "E",
        row.acroForm,
      );
    }
  });

  it("categoría D solo en descripción de mejora", () => {
    const d = ALL_COVERAGE.filter((r) => r.category === "D");
    assert.ok(d.length >= 8);
    for (const row of d) {
      assert.match(row.meaning, /Mejora/i);
    }
  });
});
