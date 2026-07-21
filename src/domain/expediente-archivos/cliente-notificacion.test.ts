import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClienteNotificacionStoragePath,
  canMesaOperateNotificacionDocumento,
  findClienteNotificacionFromList,
  mesaNotificacionDocumentoWriteEnabled,
  resolveClienteNotificacionUploadMime,
  resolveMesaNotificacionDocumentoUiMode,
  shouldShowAsesorNotificacionDocumentoSection,
  validateClienteNotificacionFile,
} from "./cliente-notificacion";
import { CLIENTE_NOTIFICACION_DOCUMENT_CONTRACT } from "./integration-docs-completos";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";
import { storageObjectKeyLooksSafe } from "./storage-path";

function makeFile(
  name: string,
  type: string,
  size: number,
): File {
  const buf = new Uint8Array(Math.max(size, 0));
  return new File([buf], name, { type });
}

describe("validateClienteNotificacionFile", () => {
  it("acepta PDF, JPG, JPEG y PNG", () => {
    assert.equal(validateClienteNotificacionFile(makeFile("a.pdf", "application/pdf", 10)).ok, true);
    assert.equal(validateClienteNotificacionFile(makeFile("a.jpg", "image/jpeg", 10)).ok, true);
    assert.equal(validateClienteNotificacionFile(makeFile("a.jpeg", "image/jpeg", 10)).ok, true);
    assert.equal(validateClienteNotificacionFile(makeFile("a.png", "image/png", 10)).ok, true);
  });

  it("rechaza MIME vacío, SVG, GIF y Word", () => {
    assert.equal(
      validateClienteNotificacionFile(makeFile("a.pdf", "", 10)).ok,
      false,
    );
    assert.match(
      (validateClienteNotificacionFile(makeFile("a.svg", "image/svg+xml", 10)) as { error: string }).error,
      /PDF, JPG, JPEG o PNG/,
    );
    assert.equal(validateClienteNotificacionFile(makeFile("a.gif", "image/gif", 10)).ok, false);
    assert.equal(
      validateClienteNotificacionFile(
        makeFile("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 10),
      ).ok,
      false,
    );
  });

  it("rechaza extensión incompatible con MIME", () => {
    const result = validateClienteNotificacionFile(makeFile("foto.png", "application/pdf", 10));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /no coincide|PDF, JPG/);
    }
  });

  it("rechaza vacío y permite exactamente 15 MB; rechaza +1 byte", () => {
    assert.equal(validateClienteNotificacionFile(makeFile("a.pdf", "application/pdf", 0)).ok, false);
    const max = CLIENTE_NOTIFICACION_DOCUMENT_CONTRACT.maxBytes;
    assert.equal(validateClienteNotificacionFile(makeFile("a.pdf", "application/pdf", max)).ok, true);
    const over = validateClienteNotificacionFile(makeFile("a.pdf", "application/pdf", max + 1));
    assert.equal(over.ok, false);
    if (!over.ok) assert.match(over.error, /15 MB/);
  });
});

describe("resolveClienteNotificacionUploadMime / path", () => {
  it("resuelve MIME canónicos", () => {
    assert.equal(
      resolveClienteNotificacionUploadMime(makeFile("x.pdf", "application/pdf", 1)),
      "application/pdf",
    );
    assert.equal(
      resolveClienteNotificacionUploadMime(makeFile("x.jpg", "image/jpeg", 1)),
      "image/jpeg",
    );
  });

  it("genera path con cliente_notificacion, uuid y sin nombre original", () => {
    const path = buildClienteNotificacionStoragePath({
      organizationId: "11111111-1111-1111-1111-111111111111",
      expedienteId: "22222222-2222-2222-2222-222222222222",
      mimeType: "application/pdf",
      originalFileName: "notificación con espacios.pdf",
    });
    assert.match(path, /\/cliente_notificacion\//);
    assert.ok(!path.includes("notificación"));
    assert.ok(!path.includes(".."));
    assert.ok(storageObjectKeyLooksSafe(path));
  });
});

describe("UI rules Notificación", () => {
  it("asesor: sección solo desde etapa 7", () => {
    assert.equal(shouldShowAsesorNotificacionDocumentoSection(6), false);
    assert.equal(shouldShowAsesorNotificacionDocumentoSection(7), true);
  });

  it("mesa: modos etapa / pendiente / cargado / solo lectura", () => {
    assert.equal(
      resolveMesaNotificacionDocumentoUiMode({ etapaActual: 6, puedeOperar: true, hasDocumento: false }),
      "etapa_bloqueada",
    );
    assert.equal(
      resolveMesaNotificacionDocumentoUiMode({ etapaActual: 7, puedeOperar: true, hasDocumento: false }),
      "pendiente",
    );
    assert.equal(
      resolveMesaNotificacionDocumentoUiMode({ etapaActual: 8, puedeOperar: true, hasDocumento: true }),
      "cargado",
    );
    assert.equal(
      resolveMesaNotificacionDocumentoUiMode({ etapaActual: 7, puedeOperar: false, hasDocumento: true }),
      "solo_lectura",
    );
    assert.equal(mesaNotificacionDocumentoWriteEnabled("etapa_bloqueada"), false);
    assert.equal(mesaNotificacionDocumentoWriteEnabled("cargado"), true);
    assert.equal(canMesaOperateNotificacionDocumento({ etapaActual: 7, puedeOperar: true }), true);
    assert.equal(canMesaOperateNotificacionDocumento({ etapaActual: 6, puedeOperar: true }), false);
  });

  it("findClienteNotificacionFromList solo toma cliente_notificacion activo", () => {
    const items: ExpedienteArchivoListItem[] = [
      {
        expediente_id: "e1",
        tipo_documento: "cliente_acta_nacimiento",
        id: "a1",
        nombre_original: "acta.pdf",
        mime_type: "application/pdf",
        size_bytes: 1,
        version: 1,
        created_at: "2026-01-01T00:00:00.000Z",
        uploaded_by_role: "mesa_control",
        uploaded_by_email: "m@x.com",
        uploaded_by_name: "Mesa",
        estatus_revision: "subido",
        comentario_mesa: null,
      },
      {
        expediente_id: "e1",
        tipo_documento: "cliente_notificacion",
        id: "p1",
        nombre_original: "notificacion-documento.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        version: 2,
        created_at: "2026-07-01T00:00:00.000Z",
        uploaded_by_role: "mesa_control",
        uploaded_by_email: "m@x.com",
        uploaded_by_name: "Mesa Uno",
        estatus_revision: "subido",
        comentario_mesa: null,
      },
    ];
    const found = findClienteNotificacionFromList(items);
    assert.equal(found?.id, "p1");
    assert.equal(found?.version, 2);
    assert.equal(found?.createdByName, "Mesa Uno");
    assert.equal(findClienteNotificacionFromList([]), null);
  });

  it("no confunde cliente_pagare ni tipo agenda notificacion", () => {
    const items: ExpedienteArchivoListItem[] = [
      {
        expediente_id: "e1",
        tipo_documento: "cliente_pagare",
        id: "pag1",
        nombre_original: "pagare.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        version: 1,
        created_at: "2026-07-01T00:00:00.000Z",
        uploaded_by_role: "mesa_control",
        uploaded_by_email: "m@x.com",
        uploaded_by_name: "Mesa",
        estatus_revision: "subido",
        comentario_mesa: null,
      },
    ];
    assert.equal(findClienteNotificacionFromList(items), null);
    assert.notEqual("cliente_notificacion", "notificacion");
  });
});
