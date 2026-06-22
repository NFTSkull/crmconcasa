import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_OBLIGATORIOS,
  countIntegrationDocsPresentes,
  deriveIntegrationDocsChecklist,
  estatusCuentaParaIntegracion,
  integrationDocsCompletos,
} from "./integration-docs-completos";
import type { IntegrationDocsResumenInput } from "./integration-docs-completos";

function resumenCompleto(
  estatus: "subido" | "resubido" | "validado" = "subido",
): IntegrationDocsResumenInput {
  return INTEGRATION_DOC_TIPOS_OBLIGATORIOS.map((tipo) => ({
    tipo_documento: tipo,
    estatus_revision: estatus,
  }));
}

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
  it("10/10 con subido cuenta como completo", () => {
    const resumen = resumenCompleto("subido");
    assert.equal(countIntegrationDocsPresentes(resumen), 10);
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("10/10 con validado y resubido cuentan", () => {
    const resumen: IntegrationDocsResumenInput = INTEGRATION_DOC_TIPOS_OBLIGATORIOS.map(
      (tipo, i) => ({
        tipo_documento: tipo,
        estatus_revision:
          i % 3 === 0 ? "subido" : i % 3 === 1 ? "resubido" : "validado",
      }),
    );
    assert.equal(countIntegrationDocsPresentes(resumen), 10);
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("9/10 deja incompleto", () => {
    const resumen = resumenCompleto("subido").slice(0, 9);
    assert.equal(countIntegrationDocsPresentes(resumen), 9);
    assert.equal(integrationDocsCompletos(resumen), false);
  });

  it("rechazado no cuenta aunque exista fila", () => {
    const resumen = resumenCompleto("subido").map((row, i) =>
      i === 0 ? { ...row, estatus_revision: "rechazado" as const } : row,
    );
    assert.equal(countIntegrationDocsPresentes(resumen), 9);
    assert.equal(integrationDocsCompletos(resumen), false);
  });

  it("deriveIntegrationDocsChecklist marca faltante y rechazado", () => {
    const resumen: IntegrationDocsResumenInput = [
      { tipo_documento: "ine", estatus_revision: "rechazado" },
      { tipo_documento: "estado_cuenta", estatus_revision: "subido" },
    ];
    const checklist = deriveIntegrationDocsChecklist(resumen);

    assert.equal(checklist.length, 10);
    assert.equal(checklist[0]?.completo, false);
    assert.equal(checklist[0]?.estatus_revision, "rechazado");
    assert.equal(checklist[1]?.completo, true);
    assert.equal(checklist[2]?.estatus_revision, "faltante");
    assert.equal(checklist[2]?.completo, false);
  });
});
