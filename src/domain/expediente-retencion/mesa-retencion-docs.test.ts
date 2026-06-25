import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMesaRetencionDocViews,
  canShowMesaRetencionSupabaseSection,
  mesaRetencionDocEstatusLabel,
} from "./mesa-retencion-docs";

describe("canShowMesaRetencionSupabaseSection", () => {
  it("visible solo en etapa 8", () => {
    assert.equal(canShowMesaRetencionSupabaseSection({ etapaActual: 8 }), true);
    assert.equal(canShowMesaRetencionSupabaseSection({ etapaActual: 7 }), false);
    assert.equal(canShowMesaRetencionSupabaseSection({ etapaActual: null }), false);
  });
});

describe("buildMesaRetencionDocViews", () => {
  it("sin opción devuelve lista vacía", () => {
    assert.equal(buildMesaRetencionDocViews(null, []).length, 0);
  });

  it("opción A lista 4 documentos con archivo resuelto", () => {
    const views = buildMesaRetencionDocViews("con_sello", [
      {
        expediente_id: "e1",
        tipo_documento: "retencion_acuse_con_sello",
        id: "d1",
        nombre_original: "acuse.pdf",
        mime_type: "application/pdf",
        size_bytes: 100,
        created_at: "2026-01-01",
        uploaded_by_role: "asesor",
        uploaded_by_email: "a@x.com",
        estatus_revision: "subido",
        comentario_mesa: null,
      },
    ]);
    assert.equal(views.length, 4);
    assert.equal(views[0]?.tipo_documento, "retencion_acuse_con_sello");
    assert.equal(views[0]?.estatus_revision, "subido");
    assert.equal(views[0]?.puedeAbrir, true);
    assert.equal(views[1]?.estatus_revision, "faltante");
  });
});

describe("mesaRetencionDocEstatusLabel", () => {
  it("copy operativo Mesa", () => {
    assert.match(mesaRetencionDocEstatusLabel("subido"), /Pendiente de revisión/i);
    assert.equal(mesaRetencionDocEstatusLabel("validado"), "Validado");
  });
});
