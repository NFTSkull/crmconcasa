import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASESOR_MESA_DOCUMENTOS_COMPARTIBLES,
  buildAsesorMesaDocumentosViews,
  labelAsesorMesaDocumento,
  shouldShowAsesorMesaDocumentosSection,
} from "./asesor-mesa-documentos";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";

function item(
  tipo: ExpedienteArchivoListItem["tipo_documento"],
  opts: Partial<ExpedienteArchivoListItem> = {},
): ExpedienteArchivoListItem {
  return {
    id: opts.id ?? `id-${tipo}`,
    expediente_id: "exp-1",
    tipo_documento: tipo,
    nombre_original: opts.nombre_original ?? `${tipo}.pdf`,
    mime_type: opts.mime_type ?? "application/pdf",
    size_bytes: opts.size_bytes ?? 100,
    version: opts.version ?? 2,
    estatus_revision: opts.estatus_revision ?? "validado",
    comentario_mesa: opts.comentario_mesa ?? null,
    created_at: opts.created_at ?? "2026-07-31T12:00:00Z",
    uploaded_by_role: opts.uploaded_by_role ?? "mesa_control",
    uploaded_by_email: opts.uploaded_by_email ?? "mesa@concasa.mx",
    uploaded_by_name: opts.uploaded_by_name ?? "Mesa",
  };
}

describe("asesor-mesa-documentos", () => {
  it("asesor propietario ve Constancia de situación fiscal", () => {
    const views = buildAsesorMesaDocumentosViews([
      item("cliente_constancia_sat", { nombre_original: "constancia.pdf" }),
    ]);
    assert.equal(views.length, 1);
    assert.equal(views[0]?.tipo_documento, "cliente_constancia_sat");
    assert.equal(labelAsesorMesaDocumento("cliente_constancia_sat"), "Constancia de situación fiscal");
    assert.equal(views[0]?.archivo.nombre_original, "constancia.pdf");
  });

  it("asesor propietario ve Semanas cotizadas", () => {
    const views = buildAsesorMesaDocumentosViews([
      item("cliente_semanas_cotizadas", { nombre_original: "semanas.pdf" }),
    ]);
    assert.equal(views[0]?.tipo_documento, "cliente_semanas_cotizadas");
    assert.equal(labelAsesorMesaDocumento("cliente_semanas_cotizadas"), "Semanas cotizadas");
  });

  it("puede preview/descargar (versión activa con id)", () => {
    const views = buildAsesorMesaDocumentosViews([
      item("cliente_acta_nacimiento", { id: "doc-acta-v2", version: 2 }),
    ]);
    assert.ok(views[0]?.archivo.id);
    assert.equal(views[0]?.version, 2);
    assert.equal(shouldShowAsesorMesaDocumentosSection(views), true);
  });

  it("sin archivo no genera tarjeta vacía", () => {
    assert.deepEqual(buildAsesorMesaDocumentosViews([]), []);
    assert.equal(shouldShowAsesorMesaDocumentosSection([]), false);
  });

  it("no expone documentos internos ni retención", () => {
    const views = buildAsesorMesaDocumentosViews([
      item("asesor_evidencia" as ExpedienteArchivoListItem["tipo_documento"]),
      item("retencion_acuse_con_sello" as ExpedienteArchivoListItem["tipo_documento"]),
      item("cliente_pagare"),
      item("cliente_constancia_sat"),
    ]);
    assert.deepEqual(
      views.map((v) => v.tipo_documento),
      ["cliente_constancia_sat"],
    );
    assert.deepEqual([...ASESOR_MESA_DOCUMENTOS_COMPARTIBLES], [
      "cliente_semanas_cotizadas",
      "cliente_acta_nacimiento",
      "cliente_constancia_sat",
    ]);
  });

  it("UI sección: Ver/Descargar sin reemplazar/eliminar", () => {
    const section = readFileSync(
      join(
        process.cwd(),
        "src/components/asesor/AsesorMesaDocumentosSection.tsx",
      ),
      "utf8",
    );
    assert.match(section, /Documentos cargados por Mesa/);
    assert.match(section, /Ver/);
    assert.match(section, /Descargar/);
    assert.match(section, /Solo lectura/);
    assert.doesNotMatch(section, /DocumentDropzone/);
    assert.doesNotMatch(section, /Reemplazar/);
    assert.doesNotMatch(section, /Eliminar/);
    assert.doesNotMatch(section, /register_mesa_documento/);
  });

  it("sin id no se muestra; estatus abrible sí", () => {
    const sinId = buildAsesorMesaDocumentosViews([
      item("cliente_constancia_sat", { id: "" }),
    ]);
    assert.equal(sinId.length, 0);

    const subido = buildAsesorMesaDocumentosViews([
      item("cliente_semanas_cotizadas", { estatus_revision: "subido" }),
    ]);
    assert.equal(subido.length, 1);
  });
});
