import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  labelCertificacionRegistroCivil,
  labelConstanciaEnvioMesa,
  labelConstanciaStatus,
  labelEstadoValidacionMesa,
  labelRfcEstimadoUi,
} from "./curp-ui-labels";

describe("identidad-curp UI labels (hotfix constancia)", () => {
  it("estado de envío depende del expediente, no del upload", () => {
    assert.equal(
      labelConstanciaEnvioMesa(false),
      "Constancia lista para enviar a Mesa.",
    );
    assert.match(
      labelConstanciaEnvioMesa(true),
      /enviada a Mesa y disponible para revisión/,
    );
  });

  it("oculta enums técnicos de análisis", () => {
    assert.doesNotMatch(
      labelConstanciaStatus("ERROR_ANALISIS"),
      /ERROR_ANALISIS/,
    );
    assert.match(
      labelConstanciaStatus("ERROR_ANALISIS"),
      /No pudimos analizar automáticamente/,
    );
    assert.match(
      labelConstanciaStatus("ERROR_ANALISIS"),
      /sí se guardó/,
    );
    assert.equal(
      labelConstanciaStatus("CURP_CERTIFICADA_REGISTRO_CIVIL"),
      "✓ CURP certificada por el Registro Civil",
    );
    assert.match(
      labelConstanciaStatus("CURP_NO_CERTIFICADA"),
      /pendiente de confirmar/,
    );
  });

  it("certificación y RFC usan microcopy amigable", () => {
    assert.match(
      labelCertificacionRegistroCivil("CONSTANCIA_NO_ANALIZADA"),
      /pendiente de confirmar/,
    );
    assert.doesNotMatch(labelRfcEstimadoUi("RFC_ESTIMADO"), /SAT/);
    assert.doesNotMatch(
      labelEstadoValidacionMesa("RFC_VALIDACION_SAT_PENDIENTE"),
      /RFC_VALIDACION_SAT/,
    );
  });

  it("no usa la frase Acta digital disponible", () => {
    for (const s of [
      "CURP_CERTIFICADA_REGISTRO_CIVIL",
      "CONSTANCIA_LEGIBLE",
      "ERROR_ANALISIS",
    ] as const) {
      assert.doesNotMatch(labelConstanciaStatus(s), /Acta digital/i);
    }
  });
});
