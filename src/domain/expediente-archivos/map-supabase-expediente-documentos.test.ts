import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSupabaseRowToExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";

describe("mapSupabaseRowToExpedienteArchivoListItem", () => {
  it("mapea fila Supabase a ítem de lista del dominio", () => {
    const item = mapSupabaseRowToExpedienteArchivoListItem({
      id: "doc-1",
      expediente_id: "exp-1",
      tipo_documento: "cliente_ine_frente",
      nombre_original: "ine-frente.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      estatus_revision: "subido",
      comentario_mesa: null,
      uploaded_by_role: "asesor",
      created_at: "2026-06-15T12:00:00.000Z",
      uploaded_by_profile: { email: "asesor@concasa.mx" },
    });

    assert.ok(item);
    assert.equal(item?.id, "doc-1");
    assert.equal(item?.tipo_documento, "cliente_ine_frente");
    assert.equal(item?.estatus_revision, "subido");
    assert.equal(item?.uploaded_by_email, "asesor@concasa.mx");
    assert.equal(item?.version, 1);
    assert.equal(item?.uploaded_by_name, "asesor@concasa.mx");
  });

  it("mapea version y full_name cuando vienen en la fila", () => {
    const item = mapSupabaseRowToExpedienteArchivoListItem({
      id: "doc-2",
      expediente_id: "exp-1",
      tipo_documento: "cliente_pagare",
      nombre_original: "pagare.pdf",
      mime_type: "application/pdf",
      size_bytes: 2048,
      version: 3,
      estatus_revision: "subido",
      comentario_mesa: null,
      uploaded_by_role: "mesa_control",
      created_at: "2026-07-20T12:00:00.000Z",
      uploaded_by_profile: { email: "mesa@concasa.mx", full_name: "Mesa Uno" },
    });
    assert.equal(item?.version, 3);
    assert.equal(item?.uploaded_by_name, "Mesa Uno");
  });

  it("retorna null para tipo fuera del catálogo", () => {
    const item = mapSupabaseRowToExpedienteArchivoListItem({
      id: "doc-x",
      expediente_id: "exp-1",
      tipo_documento: "tipo_desconocido",
      nombre_original: "x.pdf",
      mime_type: "application/pdf",
      size_bytes: 1,
      estatus_revision: "subido",
      comentario_mesa: null,
      uploaded_by_role: "asesor",
      created_at: "2026-06-15T12:00:00.000Z",
    });

    assert.equal(item, null);
  });
});
