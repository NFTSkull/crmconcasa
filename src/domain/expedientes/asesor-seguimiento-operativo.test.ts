import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ETAPAS_OPERATIVAS_ASESOR,
  asesorSubestadoOperativoLabel,
  estadoEnvioMesaLabel,
  getEtapaOperativaNombre,
  getEtapaTimelineBadgeLabel,
  getEtapaTimelineVisual,
} from "./asesor-seguimiento-operativo";

describe("ETAPAS_OPERATIVAS_ASESOR", () => {
  it("define exactamente 12 etapas con nombres oficiales", () => {
    assert.equal(ETAPAS_OPERATIVAS_ASESOR.length, 12);
    assert.equal(ETAPAS_OPERATIVAS_ASESOR[0]?.nombre, "Integración");
    assert.equal(ETAPAS_OPERATIVAS_ASESOR[11]?.nombre, "Pago a ConCasa");
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
    assert.equal(getEtapaTimelineVisual(2, 1), "pendiente");
  });
});
