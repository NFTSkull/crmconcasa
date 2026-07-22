import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ETAPAS_OPERATIVAS_ASESOR,
  ETAPAS_VISUALES_OPERATIVAS,
  TOTAL_PASOS_VISUALES_OPERATIVOS,
  asesorSubestadoOperativoLabel,
  estadoEnvioMesaLabel,
  etapasInternasParaPasoVisual,
  getEtapaOperativaNombre,
  getEtapaTimelineBadgeLabel,
  getEtapaTimelineVisual,
  getEtapaTimelineVisualPorPasoVisual,
  getEtapaVisualNombre,
  mapEtapaInternaAPasoVisual,
} from "./asesor-seguimiento-operativo";

describe("ETAPAS_OPERATIVAS_ASESOR", () => {
  it("define exactamente 12 etapas internas con nombres oficiales", () => {
    assert.equal(ETAPAS_OPERATIVAS_ASESOR.length, 12);
    assert.equal(ETAPAS_OPERATIVAS_ASESOR[0]?.nombre, "Integración");
    assert.equal(ETAPAS_OPERATIVAS_ASESOR[11]?.nombre, "Pago a ConCasa");
  });
});

describe("ETAPAS_VISUALES_OPERATIVAS", () => {
  it("muestra 11 pasos sin etapa interna 4", () => {
    assert.equal(TOTAL_PASOS_VISUALES_OPERATIVOS, 11);
    assert.equal(ETAPAS_VISUALES_OPERATIVAS.length, 11);
    assert.equal(
      ETAPAS_VISUALES_OPERATIVAS.some((e) => e.etapaInterna === 4),
      false,
    );
    assert.equal(ETAPAS_VISUALES_OPERATIVAS[2]?.etapaInterna, 3);
    assert.equal(ETAPAS_VISUALES_OPERATIVAS[3]?.etapaInterna, 5);
  });

  it("mapea etapa legacy 4 al paso visual 3", () => {
    assert.equal(mapEtapaInternaAPasoVisual(4), 3);
    assert.equal(getEtapaVisualNombre(4), "Listo para cita de biométrico");
  });

  it("inverso: paso 3 → internas 3 y 4; paso 4 → 5; paso 11 → 12", () => {
    assert.deepEqual(etapasInternasParaPasoVisual(3), [3, 4]);
    assert.deepEqual(etapasInternasParaPasoVisual(4), [5]);
    assert.deepEqual(etapasInternasParaPasoVisual(11), [12]);
  });

  it("marca paso visual según etapa interna", () => {
    assert.equal(getEtapaTimelineVisualPorPasoVisual(2, 3), "completado");
    assert.equal(getEtapaTimelineVisualPorPasoVisual(3, 3), "actual");
    assert.equal(getEtapaTimelineVisualPorPasoVisual(4, 3), "pendiente");
    assert.equal(getEtapaTimelineVisualPorPasoVisual(3, 4), "actual");
    assert.equal(getEtapaTimelineVisualPorPasoVisual(4, 5), "actual");
  });
});

describe("getEtapaTimelineVisual", () => {
  it("marca etapas anteriores como completado y posteriores pendiente", () => {
    assert.equal(getEtapaTimelineVisual(1, 3), "completado");
    assert.equal(getEtapaTimelineVisual(3, 3), "actual");
    assert.equal(getEtapaTimelineVisual(5, 3), "pendiente");
  });
});

describe("estado envío y subestado asesor", () => {
  it("Caso A — sin enviar a Mesa", () => {
    assert.equal(estadoEnvioMesaLabel(false), "Pendiente de enviar a Mesa");
    assert.equal(asesorSubestadoOperativoLabel("pendiente", false), "Pendiente");
    assert.equal(
      getEtapaTimelineBadgeLabel("actual", 1, "pendiente", false),
      "Pendiente",
    );
    assert.equal(getEtapaTimelineVisual(1, 1), "actual");
    assert.equal(getEtapaTimelineVisual(2, 1), "pendiente");
  });

  it("Caso B — enviado a Mesa en etapa 1", () => {
    assert.equal(estadoEnvioMesaLabel(true), "Enviado a Mesa");
    assert.equal(
      asesorSubestadoOperativoLabel("en_validacion_mesa", true),
      "En validación Mesa",
    );
    assert.equal(
      getEtapaTimelineBadgeLabel("actual", 1, "en_validacion_mesa", true),
      "En validación Mesa",
    );
    assert.equal(getEtapaOperativaNombre(1), "Integración");
  });
});
