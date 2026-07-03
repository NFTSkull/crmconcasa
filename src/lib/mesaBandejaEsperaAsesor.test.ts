import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estaEnEsperaDeAsesor } from "@/lib/mesaBandejaEsperaAsesor";

describe("mesaBandejaEsperaAsesor", () => {
  it("correccion_requerida → en espera de asesor", () => {
    assert.equal(estaEnEsperaDeAsesor("correccion_requerida"), true);
  });

  it("correccion_enviada y otros resúmenes → accionables por Mesa", () => {
    assert.equal(estaEnEsperaDeAsesor("correccion_enviada"), false);
    assert.equal(estaEnEsperaDeAsesor("pendiente_revision_documental"), false);
    assert.equal(estaEnEsperaDeAsesor("documentos_validados"), false);
    assert.equal(estaEnEsperaDeAsesor("faltantes"), false);
    assert.equal(estaEnEsperaDeAsesor(undefined), false);
    assert.equal(estaEnEsperaDeAsesor(null), false);
  });
});
