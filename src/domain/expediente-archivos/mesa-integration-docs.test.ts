import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMesaIntegrationDocViews,
  resolveMesaArchivoPorTipo,
} from "./mesa-integration-docs";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";
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

function listaItem(
  tipo: ExpedienteArchivoListItem["tipo_documento"],
  partial: Partial<ExpedienteArchivoListItem> = {},
): ExpedienteArchivoListItem {
  return {
    expediente_id: EXP_ID,
    tipo_documento: tipo,
    id: "doc-ine-1",
    nombre_original: "ine.pdf",
    mime_type: "application/pdf",
    size_bytes: 100,
    created_at: "2026-06-01T00:00:00.000Z",
    uploaded_by_role: "asesor",
    uploaded_by_email: "asesor@concasa.mx",
    estatus_revision: "subido",
    comentario_mesa: null,
    ...partial,
  };
}

test("resolveMesaArchivoPorTipo: prioriza lista activa con id real", () => {
  const catalog = [
    catalogRow("cliente_ine_frente", { estatus_revision: "faltante", id: null }),
  ];
  const lista = [listaItem("cliente_ine_frente")];
  const resolved = resolveMesaArchivoPorTipo("cliente_ine_frente", catalog, lista);
  assert.equal(resolved?.id, "doc-ine-1");
  assert.equal(resolved?.nombre_original, "ine.pdf");
});

test("resolveMesaArchivoPorTipo: elige el más reciente por created_at", () => {
  const catalog = [
    catalogRow("cliente_ine_frente", {
      id: "doc-old-cat",
      estatus_revision: "subido",
      nombre_original: "viejo.pdf",
      created_at: "2026-06-01T00:00:00.000Z",
    }),
  ];
  const lista = [
    listaItem("cliente_ine_frente", {
      id: "doc-old",
      nombre_original: "viejo.pdf",
      created_at: "2026-06-01T00:00:00.000Z",
    }),
    listaItem("cliente_ine_frente", {
      id: "doc-new",
      nombre_original: "nuevo.pdf",
      created_at: "2026-07-01T00:00:00.000Z",
    }),
  ];
  const resolved = resolveMesaArchivoPorTipo("cliente_ine_frente", catalog, lista);
  assert.equal(resolved?.id, "doc-new");
  assert.equal(resolved?.nombre_original, "nuevo.pdf");
});

test("buildMesaIntegrationDocViews: 4 obligatorios + opcionales solo asesor (sin complementarios Mesa)", () => {
  const catalog = [
    catalogRow("nss", { estatus_revision: "subido", id: "doc-nss" }),
    catalogRow("cliente_ine_frente"),
    catalogRow("cliente_semanas_cotizadas", { estatus_revision: "subido", id: "doc-sem" }),
    catalogRow("cliente_carta_empresa", { estatus_revision: "subido", id: "doc-carta" }),
    catalogRow("cliente_acta_nacimiento_digital", {
      estatus_revision: "subido",
      id: "doc-acta-digital",
    }),
    catalogRow("cliente_acta_nacimiento"),
  ];
  const views = buildMesaIntegrationDocViews(catalog, []);
  const tipos = views.map((v) => v.tipo_documento as string);
  assert.equal(views.length, 6);
  assert.ok(!tipos.includes("nss"));
  assert.ok(!tipos.includes("cliente_semanas_cotizadas"));
  assert.ok(tipos.includes("cliente_carta_empresa"));
  assert.ok(tipos.includes("cliente_acta_nacimiento_digital"));
  assert.ok(!tipos.includes("cliente_acta_nacimiento"));
  assert.ok(!tipos.includes("cliente_constancia_sat"));
  const carta = views.find((v) => v.tipo_documento === "cliente_carta_empresa");
  assert.equal(carta?.opcional, true);
  assert.equal(carta?.archivo?.id, "doc-carta");
  const actaDigital = views.find(
    (v) => v.tipo_documento === "cliente_acta_nacimiento_digital",
  );
  assert.equal(actaDigital?.opcional, true);
  assert.equal(actaDigital?.archivo?.id, "doc-acta-digital");
});

test("buildMesaIntegrationDocViews: subido con id permite abrir; faltante no", () => {
  const catalog = [
    catalogRow("cliente_ine_frente", {
      id: "doc-ine-cat",
      estatus_revision: "subido",
      nombre_original: "ine-cat.pdf",
      mime_type: "application/pdf",
    }),
    catalogRow("cliente_ine_reverso"),
  ];
  const views = buildMesaIntegrationDocViews(catalog, []);
  const ine = views.find((v) => v.tipo_documento === "cliente_ine_frente");
  const reverso = views.find((v) => v.tipo_documento === "cliente_ine_reverso");
  assert.ok(ine);
  assert.ok(reverso);
  assert.equal(ine.estatus_revision, "subido");
  assert.equal(ine.archivo?.id, "doc-ine-cat");
  assert.equal(reverso.estatus_revision, "faltante");
  assert.equal(reverso.archivo, null);
});
