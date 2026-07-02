import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  countIntegrationDocsPresentes,
  deriveIntegrationDocsChecklist,
  deriveIntegrationDocsChecklistOpcionales,
  estatusCuentaParaIntegracion,
  integrationDocsCompletos,
  integrationDocsTodosValidados,
  countIntegrationDocsValidados,
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
  it("validación Mesa y avance 1→2 solo con 4 documentos del asesor", () => {
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length, 4);
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES.length, 1);
    assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD.length, 5);
    assert.equal(INTEGRATION_DOC_TIPOS_VALIDACION_MESA.length, 4);
    assert.deepEqual(INTEGRATION_DOC_TIPOS_VALIDACION_MESA, INTEGRATION_DOC_TIPOS_ASESOR_ENVIO);
    assert.ok(!(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes("nss"));
    assert.ok(!(INTEGRATION_DOC_TIPOS_VALIDACION_MESA as readonly string[]).includes("cliente_acta_nacimiento"));
    assert.ok(!(INTEGRATION_DOC_TIPOS_VALIDACION_MESA as readonly string[]).includes("cliente_constancia_sat"));
    assert.ok(!(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes("ine"));
    assert.ok(!(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes("estado_cuenta"));
    assert.ok(!(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes("direccion"));
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes(
        "cliente_acta_nacimiento",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes(
        "cliente_constancia_sat",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        "cliente_acta_nacimiento",
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[]).includes(
        "cliente_constancia_sat",
      ),
    );
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
  it("4/4 con subido cuenta como completo", () => {
    const resumen = resumenCompletoAsesor("subido");
    assert.equal(countIntegrationDocsPresentes(resumen), 4);
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("4/4 con validado y resubido cuentan", () => {
    const resumen: IntegrationDocsResumenInput = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map(
      (tipo, i) => ({
        tipo_documento: tipo,
        estatus_revision:
          i % 3 === 0 ? "subido" : i % 3 === 1 ? "resubido" : "validado",
      }),
    );
    assert.equal(countIntegrationDocsPresentes(resumen), 4);
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

  it("semanas cotizadas opcional no cuenta para gate asesor", () => {
    const resumen = [
      ...resumenCompletoAsesor("subido"),
      { tipo_documento: "cliente_semanas_cotizadas" as const, estatus_revision: "subido" as const },
    ];
    assert.equal(countIntegrationDocsPresentes(resumen), 4);
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("3/4 deja incompleto", () => {
    const resumen = resumenCompletoAsesor("subido").slice(0, 3);
    assert.equal(countIntegrationDocsPresentes(resumen), 3);
    assert.equal(integrationDocsCompletos(resumen), false);
  });

  it("rechazado no cuenta aunque exista fila", () => {
    const resumen = resumenCompletoAsesor("subido").map((row, i) =>
      i === 0 ? { ...row, estatus_revision: "rechazado" as const } : row,
    );
    assert.equal(countIntegrationDocsPresentes(resumen), 3);
    assert.equal(integrationDocsCompletos(resumen), false);
  });

  it("deriveIntegrationDocsChecklist lista solo 4 tipos obligatorios sin nss", () => {
    const resumen: IntegrationDocsResumenInput = [
      { tipo_documento: "cliente_ine_frente", estatus_revision: "rechazado" },
      { tipo_documento: "cliente_ine_reverso", estatus_revision: "subido" },
    ];
    const checklist = deriveIntegrationDocsChecklist(resumen);

    assert.equal(checklist.length, 4);
    assert.ok(!(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes("nss"));
    assert.equal(checklist[0]?.completo, false);
    assert.equal(checklist[0]?.estatus_revision, "rechazado");
    assert.equal(checklist[0]?.opcional, false);
    assert.equal(checklist[1]?.completo, true);
    assert.equal(checklist[2]?.estatus_revision, "faltante");
    assert.equal(checklist[2]?.completo, false);
  });

  it("deriveIntegrationDocsChecklistOpcionales lista semanas cotizadas", () => {
    const checklist = deriveIntegrationDocsChecklistOpcionales([]);
    assert.equal(checklist.length, 1);
    assert.equal(checklist[0]?.tipo_documento, "cliente_semanas_cotizadas");
    assert.equal(checklist[0]?.opcional, true);
    assert.equal(checklist[0]?.completo, false);
  });
});

describe("integrationDocsTodosValidados", () => {
  it("requiere 4 validados del asesor; acta/SAT no cuentan", () => {
    const soloAsesor = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map((tipo) => ({
      tipo_documento: tipo,
      estatus_revision: "validado" as const,
    }));
    assert.equal(countIntegrationDocsValidados(soloAsesor), 4);
    assert.equal(integrationDocsTodosValidados(soloAsesor), true);

    const conComplementariosFaltantes = [
      ...soloAsesor,
      { tipo_documento: "cliente_acta_nacimiento" as const, estatus_revision: "faltante" as const },
      { tipo_documento: "cliente_constancia_sat" as const, estatus_revision: "faltante" as const },
    ];
    assert.equal(integrationDocsTodosValidados(conComplementariosFaltantes), true);

    const incompleto = soloAsesor.slice(0, 3);
    assert.equal(integrationDocsTodosValidados(incompleto), false);
  });

  it("resubido no cuenta como validado para Mesa 1→2", () => {
    const resumen = INTEGRATION_DOC_TIPOS_VALIDACION_MESA.map((tipo, i) => ({
      tipo_documento: tipo,
      estatus_revision: i === 0 ? ("resubido" as const) : ("validado" as const),
    }));
    assert.equal(integrationDocsTodosValidados(resumen), false);
  });
});
