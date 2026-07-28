import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INGRESOS_DEFAULT_FILTER_UI,
  buildIngresosAlcanceSummary,
  isIngresosFilterUiDefault,
  resetIngresosFilterUi,
} from "./filters";

describe("P137 ingresos filters reset", () => {
  it("default es all_submitted sin asesores ni etapa", () => {
    assert.equal(INGRESOS_DEFAULT_FILTER_UI.stageScope, "all_submitted");
    assert.equal(INGRESOS_DEFAULT_FILTER_UI.visibleStep, null);
    assert.deepEqual(INGRESOS_DEFAULT_FILTER_UI.selectedAsesorIds, []);
    assert.equal(isIngresosFilterUiDefault(INGRESOS_DEFAULT_FILTER_UI), true);
  });

  it("reset limpia asesores, etapa, fuente, búsqueda y página", () => {
    const dirty = {
      ...INGRESOS_DEFAULT_FILTER_UI,
      selectedAsesorIds: ["a", "b"],
      stageScope: "exact_step" as const,
      visibleStep: 7,
      montoFuente: "mesa_actualizado" as const,
      estado: "pagados" as const,
      buscar: "NSS",
      page: 4,
      porcentajes: [20],
    };
    assert.equal(isIngresosFilterUiDefault(dirty), false);
    const reset = resetIngresosFilterUi();
    assert.equal(isIngresosFilterUiDefault(reset), true);
    assert.deepEqual(reset.selectedAsesorIds, []);
    assert.equal(reset.stageScope, "all_submitted");
    assert.equal(reset.visibleStep, null);
    assert.equal(reset.page, 1);
    assert.equal(reset.buscar, "");
    assert.deepEqual(reset.porcentajes, []);
  });

  it("resumen de alcance según modo", () => {
    assert.match(
      buildIngresosAlcanceSummary({ stageScope: "all_submitted", visibleStep: null }),
      /todos los expedientes enviados/i,
    );
    assert.match(
      buildIngresosAlcanceSummary({
        stageScope: "from_step",
        visibleStep: 4,
        pasoLabel: "Paso 4 · Biometría (resultado)",
      }),
      /desde Paso 4 · Biometría \(resultado\) en adelante/i,
    );
    assert.match(
      buildIngresosAlcanceSummary({
        stageScope: "exact_step",
        visibleStep: 7,
        pasoLabel: "Paso 7 · Acuse / Aviso de retención",
      }),
      /únicamente Paso 7 · Acuse/i,
    );
  });
});
