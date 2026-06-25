import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_MESA_UPLOAD,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
} from "./integration-docs-completos";
import {
  buildMesaComplementariosDocViews,
  semanasCotizadasEsOpcionalMesa,
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

  it("semanas cotizadas es opcional; acta y constancia requeridas para Mesa", () => {
    const views = buildMesaComplementariosDocViews([]);
    const semanas = views.find((v) => v.tipo_documento === "cliente_semanas_cotizadas");
    const acta = views.find((v) => v.tipo_documento === "cliente_acta_nacimiento");
    const sat = views.find((v) => v.tipo_documento === "cliente_constancia_sat");
    assert.equal(semanas?.etiqueta, "opcional");
    assert.equal(acta?.etiqueta, "requerido_mesa");
    assert.equal(sat?.etiqueta, "requerido_mesa");
  });

  it("acta y constancia aparecen faltantes si no hay archivo", () => {
    const views = buildMesaComplementariosDocViews([]);
    assert.equal(
      views.find((v) => v.tipo_documento === "cliente_acta_nacimiento")?.estatus_revision,
      "faltante",
    );
    assert.equal(
      views.find((v) => v.tipo_documento === "cliente_constancia_sat")?.estatus_revision,
      "faltante",
    );
  });

  it("semanas no está en obligatorios de envío asesor ni en validación 7 sin ser obligatoria de gate", () => {
    assert.ok(semanasCotizadasEsOpcionalMesa());
    assert.ok(!(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes("cliente_semanas_cotizadas"));
    assert.ok(INTEGRATION_DOC_TIPOS_VALIDACION_MESA.includes("cliente_acta_nacimiento"));
    assert.ok(INTEGRATION_DOC_TIPOS_VALIDACION_MESA.includes("cliente_constancia_sat"));
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_VALIDACION_MESA as readonly string[]).includes(
        "cliente_semanas_cotizadas",
      ),
    );
  });

  it("resuelve archivo subido desde catálogo", () => {
    const catalog = [
      catalogRow("cliente_acta_nacimiento", {
        id: "doc-acta",
        estatus_revision: "subido",
        nombre_original: "acta.pdf",
        mime_type: "application/pdf",
      }),
    ];
    const views = buildMesaComplementariosDocViews(catalog);
    const acta = views.find((v) => v.tipo_documento === "cliente_acta_nacimiento");
    assert.equal(acta?.estatus_revision, "subido");
    assert.equal(acta?.archivo?.id, "doc-acta");
  });
});
