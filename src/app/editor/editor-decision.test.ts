import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDecisionPayload,
  clearRowSaveUiState,
  computeDecision,
  formatMontoInputValue,
  formatRowSaveErrorLabel,
} from "./editor-decision";

describe("editor-decision", () => {
  it("computeDecision — monto con miles MX aprueba", () => {
    assert.equal(computeDecision("89.490", ""), "aprobado");
    assert.equal(computeDecision("89490", ""), "aprobado");
  });

  it("buildDecisionPayload — 89.490 guarda 89490", () => {
    assert.deepEqual(buildDecisionPayload("89.490", ""), {
      decision: "aprobado",
      monto_aprobado: 89490,
      notas_revision: "",
    });
  });

  it("buildDecisionPayload — no cumple sin monto", () => {
    assert.deepEqual(buildDecisionPayload("", "Falta documentación"), {
      decision: "no_cumple",
      monto_aprobado: null,
      notas_revision: "Falta documentación",
    });
  });

  it("buildDecisionPayload — rechaza monto inválido", () => {
    assert.throws(
      () => buildDecisionPayload("$89,490", ""),
      /Formato de monto aprobado inválido/,
    );
  });

  it("formatMontoInputValue — null a vacío", () => {
    assert.equal(formatMontoInputValue(null), "");
    assert.equal(formatMontoInputValue(89490), "89490");
  });

  it("formatRowSaveErrorLabel — expone mensaje útil", () => {
    assert.equal(formatRowSaveErrorLabel(undefined), "Error");
    assert.equal(
      formatRowSaveErrorLabel("Formato de monto aprobado inválido."),
      "Formato de monto aprobado inválido.",
    );
    assert.match(
      formatRowSaveErrorLabel("x".repeat(60)),
      /…$/,
    );
  });

  it("clearRowSaveUiState — cancela timers pendientes", () => {
    let debounceFired = false;
    let savedClearFired = false;
    const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {
      a: setTimeout(() => {
        debounceFired = true;
      }, 50),
    };
    const savedClearTimers: Record<string, ReturnType<typeof setTimeout>> = {
      a: setTimeout(() => {
        savedClearFired = true;
      }, 50),
    };

    const next = clearRowSaveUiState({ debounceTimers, savedClearTimers });
    assert.deepEqual(next, {});
    assert.equal(Object.keys(debounceTimers).length, 0);
    assert.equal(Object.keys(savedClearTimers).length, 0);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.equal(debounceFired, false);
        assert.equal(savedClearFired, false);
        resolve();
      }, 80);
    });
  });
});
