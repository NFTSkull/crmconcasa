import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasMesaMontoOverride,
  shouldShowAsesorMontoMejoravitSection,
  shouldShowMesaMontoUpdateButton,
} from "./ui-rules";

describe("ui-rules P090", () => {
  it("asesor oculta sin override Mesa", () => {
    assert.equal(
      shouldShowAsesorMontoMejoravitSection({ montoMejoravitActualizado: null }),
      false,
    );
    assert.equal(shouldShowAsesorMontoMejoravitSection(null), false);
  });

  it("asesor muestra con override", () => {
    assert.equal(
      shouldShowAsesorMontoMejoravitSection({ montoMejoravitActualizado: 200000 }),
      true,
    );
  });

  it("botón Mesa solo con canUpdate", () => {
    assert.equal(shouldShowMesaMontoUpdateButton({ canUpdate: true }), true);
    assert.equal(shouldShowMesaMontoUpdateButton({ canUpdate: false }), false);
    assert.equal(shouldShowMesaMontoUpdateButton(null), false);
  });

  it("hasMesaMontoOverride", () => {
    assert.equal(hasMesaMontoOverride({ montoMejoravitActualizado: 1 }), true);
    assert.equal(hasMesaMontoOverride({ montoMejoravitActualizado: null }), false);
  });
});
