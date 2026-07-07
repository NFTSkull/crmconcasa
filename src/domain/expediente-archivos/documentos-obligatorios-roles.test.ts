import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveIntegrationDocsChecklist,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES_SOLO_ASESOR,
  INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD,
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  integrationDocsCompletos,
} from "./integration-docs-completos";
import { buildMesaComplementariosDocViews } from "./mesa-complementarios-docs";
import { buildMesaIntegrationDocViews } from "./mesa-integration-docs";

describe("documentos obligatorios por rol (P044)", () => {
  it("asesor no ve documento NSS en checklist obligatorio", () => {
    const checklist = deriveIntegrationDocsChecklist([]);
    const tipos = checklist.map((c) => c.tipo_documento);
    assert.ok(!tipos.includes("nss" as never));
  });

  it("asesor no ve Acta de nacimiento ni Constancia SAT en checklist", () => {
    const checklist = deriveIntegrationDocsChecklist([]);
    const tipos = checklist.map((c) => c.tipo_documento as string);
    assert.ok(!tipos.includes("cliente_acta_nacimiento"));
    assert.ok(!tipos.includes("cliente_constancia_sat"));
  });

  it("Mesa no ve NSS en documentos del asesor", () => {
    const views = buildMesaIntegrationDocViews([], []);
    const tipos = views.map((v) => v.tipo_documento as string);
    assert.ok(!tipos.includes("nss"));
    assert.equal(
      views.length,
      INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length +
        INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES_SOLO_ASESOR.length,
    );
  });

  it("Mesa sí ve Acta de nacimiento y Constancia SAT como complementarios", () => {
    const views = buildMesaComplementariosDocViews([]);
    const tipos = views.map((v) => v.tipo_documento);
    assert.ok(tipos.includes("cliente_acta_nacimiento"));
    assert.ok(tipos.includes("cliente_constancia_sat"));
  });

  it("enviar a Mesa no bloquea por NSS/Acta/SAT faltantes", () => {
    const resumen = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map((tipo) => ({
      tipo_documento: tipo,
      estatus_revision: "subido" as const,
    }));
    assert.equal(integrationDocsCompletos(resumen), true);
  });

  it("enviar a Mesa bloquea si falta INE frente", () => {
    const resumen = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.filter(
      (t) => t !== "cliente_ine_frente",
    ).map((tipo) => ({
      tipo_documento: tipo,
      estatus_revision: "subido" as const,
    }));
    assert.equal(integrationDocsCompletos(resumen), false);
  });

  it("asesor upload no incluye nss, acta ni SAT", () => {
    const upload = INTEGRATION_DOC_TIPOS_ASESOR_UPLOAD as readonly string[];
    assert.ok(!upload.includes("nss"));
    assert.ok(!upload.includes("cliente_acta_nacimiento"));
    assert.ok(!upload.includes("cliente_constancia_sat"));
  });

  it("Mesa upload incluye acta y SAT", () => {
    const mesa = INTEGRATION_DOC_TIPOS_MESA_UPLOAD as readonly string[];
    assert.ok(mesa.includes("cliente_acta_nacimiento"));
    assert.ok(mesa.includes("cliente_constancia_sat"));
    assert.ok(!mesa.includes("nss"));
  });
});
