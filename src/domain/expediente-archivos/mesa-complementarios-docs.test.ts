import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
} from "./integration-docs-completos";
import {
  buildMesaComplementariosDocViews,
  complementariosMesaSonOpcionales,
  labelPresenciaComplementario,
} from "./mesa-complementarios-docs";
import type { ExpedienteArchivoResumen } from "./types";

const EXP_ID = "exp-1";

function catalogRow(
  tipo: ExpedienteArchivoResumen["tipo_documento"],
  partial: Partial<ExpedienteArchivoResumen> = {},
): ExpedienteArchivoResumen {
  return {
    expediente_id: EXP_ID,
    tipo_documento: tipo,
    id: null,
    nombre_original: null,
    mime_type: null,
    size_bytes: null,
    created_at: null,
    uploaded_by_role: null,
    uploaded_by_email: null,
    estatus_revision: "faltante",
    comentario_mesa: null,
    ...partial,
  };
}

describe("buildMesaComplementariosDocViews", () => {
  it("expone 3 tipos Mesa: semanas, acta y constancia SAT", () => {
    const views = buildMesaComplementariosDocViews([]);
    assert.equal(views.length, 3);
    assert.deepEqual(
      views.map((v) => v.tipo_documento),
      [...INTEGRATION_DOC_TIPOS_MESA_UPLOAD],
    );
  });

  it("los 3 complementarios son opcionales con presencia neutral", () => {
    const views = buildMesaComplementariosDocViews([]);
    for (const view of views) {
      assert.equal(view.presencia, "faltante");
      assert.equal(labelPresenciaComplementario(view.presencia), "Faltante");
    }
    const acta = views.find((v) => v.tipo_documento === "cliente_acta_nacimiento");
    const sat = views.find((v) => v.tipo_documento === "cliente_constancia_sat");
    assert.equal(acta?.presencia, "faltante");
    assert.equal(sat?.presencia, "faltante");
  });

  it("archivo subido mapea a presencia cargado sin exponer validación", () => {
    const catalog = [
      catalogRow("cliente_acta_nacimiento", {
        id: "doc-acta",
        estatus_revision: "validado",
        nombre_original: "acta.pdf",
        mime_type: "application/pdf",
      }),
      catalogRow("cliente_constancia_sat", {
        id: "doc-sat",
        estatus_revision: "rechazado",
        comentario_mesa: "ilegible",
      }),
    ];
    const views = buildMesaComplementariosDocViews(catalog);
    const acta = views.find((v) => v.tipo_documento === "cliente_acta_nacimiento");
    const sat = views.find((v) => v.tipo_documento === "cliente_constancia_sat");
    assert.equal(acta?.presencia, "cargado");
    assert.equal(labelPresenciaComplementario(acta!.presencia), "Cargado");
    assert.equal(sat?.presencia, "cargado");
    assert.equal(acta?.archivo?.id, "doc-acta");
  });

  it("complementarios no están en validación Mesa obligatoria (5 asesor)", () => {
    assert.ok(complementariosMesaSonOpcionales());
    assert.equal(INTEGRATION_DOC_TIPOS_VALIDACION_MESA.length, 4);
    for (const tipo of INTEGRATION_DOC_TIPOS_MESA_UPLOAD) {
      assert.ok(
        !(INTEGRATION_DOC_TIPOS_VALIDACION_MESA as readonly string[]).includes(tipo),
      );
    }
    assert.ok(!(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes("cliente_semanas_cotizadas"));
  });
});
