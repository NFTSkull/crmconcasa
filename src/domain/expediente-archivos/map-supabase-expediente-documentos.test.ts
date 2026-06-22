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
