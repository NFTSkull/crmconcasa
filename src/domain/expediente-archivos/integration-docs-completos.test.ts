import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  countIntegrationDocsPresentes,
  deriveIntegrationDocsChecklist,
  estatusCuentaParaIntegracion,
  integrationDocsCompletos,
} from "./integration-docs-completos";
import type { IntegrationDocsResumenInput } from "./integration-docs-completos";

function resumenCompletoAsesor(
  estatus: "subido" | "resubido" | "validado" = "subido",
): IntegrationDocsResumenInput {
  return INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map((tipo) => ({
    tipo_documento: tipo,
    estatus_revision: estatus,
  }));
}

describe("INTEGRATION_DOC_TIPOS_VALIDACION_MESA", () => {
  it("incluye 8 asesor + acta + constancia SAT", () => {
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length, 8);
    assert.equal(INTEGRATION_DOC_TIPOS_VALIDACION_MESA.length, 10);
    assert.ok(INTEGRATION_DOC_TIPOS_VALIDACION_MESA.includes("cliente_acta_nacimiento"));
    assert.ok(INTEGRATION_DOC_TIPOS_VALIDACION_MESA.includes("cliente_constancia_sat"));
  });
});

describe("estatusCuentaParaIntegracion", () => {
  it("acepta subido, resubido y validado", () => {
    assert.equal(estatusCuentaParaIntegracion("subido"), true);
    assert.equal(estatusCuentaParaIntegracion("resubido"), true);
    assert.equal(estatusCuentaParaIntegracion("validado"), true);
  });

  it("rechaza rechazado y faltante", () => {
    assert.equal(estatusCuentaParaIntegracion("rechazado"), false);
    assert.equal(estatusCuentaParaIntegracion("faltante"), false);
  });
});

describe("integrationDocsCompletos", () => {
  it("8/8 con subido cuenta como completo", () => {
    const resumen = resumenCompletoAsesor("subido");
    assert.equal(countIntegrationDocsPresentes(resumen), 8);
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("8/8 con validado y resubido cuentan", () => {
    const resumen: IntegrationDocsResumenInput = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map(
      (tipo, i) => ({
        tipo_documento: tipo,
        estatus_revision:
          i % 3 === 0 ? "subido" : i % 3 === 1 ? "resubido" : "validado",
      }),
    );
    assert.equal(countIntegrationDocsPresentes(resumen), 8);
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("acta/constancia SAT no cuentan para gate asesor", () => {
    const resumen = [
      ...resumenCompletoAsesor("subido"),
      { tipo_documento: "cliente_acta_nacimiento" as const, estatus_revision: "faltante" as const },
      { tipo_documento: "cliente_constancia_sat" as const, estatus_revision: "faltante" as const },
    ];
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("7/8 deja incompleto", () => {
    const resumen = resumenCompletoAsesor("subido").slice(0, 7);
    assert.equal(countIntegrationDocsPresentes(resumen), 7);
    assert.equal(integrationDocsCompletos(resumen), false);
  });

  it("rechazado no cuenta aunque exista fila", () => {
    const resumen = resumenCompletoAsesor("subido").map((row, i) =>
      i === 0 ? { ...row, estatus_revision: "rechazado" as const } : row,
    );
    assert.equal(countIntegrationDocsPresentes(resumen), 7);
    assert.equal(integrationDocsCompletos(resumen), false);
  });

  it("deriveIntegrationDocsChecklist lista solo 8 tipos asesor", () => {
    const resumen: IntegrationDocsResumenInput = [
      { tipo_documento: "ine", estatus_revision: "rechazado" },
      { tipo_documento: "estado_cuenta", estatus_revision: "subido" },
    ];
    const checklist = deriveIntegrationDocsChecklist(resumen);

    assert.equal(checklist.length, 8);
    assert.equal(checklist[0]?.completo, false);
    assert.equal(checklist[0]?.estatus_revision, "rechazado");
    assert.equal(checklist[1]?.completo, true);
    assert.equal(checklist[2]?.estatus_revision, "faltante");
    assert.equal(checklist[2]?.completo, false);
  });
});
