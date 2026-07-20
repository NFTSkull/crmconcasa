import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClientePagareStoragePath,
  canMesaOperatePagare,
  findClientePagareFromList,
  mesaPagareWriteEnabled,
  resolveClientePagareUploadMime,
  resolveMesaPagareUiMode,
  shouldShowAsesorPagareSection,
  validateClientePagareFile,
} from "./cliente-pagare";
import { CLIENTE_PAGARE_DOCUMENT_CONTRACT } from "./integration-docs-completos";
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

describe("validateClientePagareFile", () => {
  it("acepta PDF, JPG, JPEG y PNG", () => {
    assert.equal(validateClientePagareFile(makeFile("a.pdf", "application/pdf", 10)).ok, true);
    assert.equal(validateClientePagareFile(makeFile("a.jpg", "image/jpeg", 10)).ok, true);
    assert.equal(validateClientePagareFile(makeFile("a.jpeg", "image/jpeg", 10)).ok, true);
    assert.equal(validateClientePagareFile(makeFile("a.png", "image/png", 10)).ok, true);
  });

  it("rechaza MIME vacío, SVG, GIF y Word", () => {
    assert.equal(
      validateClientePagareFile(makeFile("a.pdf", "", 10)).ok,
      false,
    );
    assert.match(
      (validateClientePagareFile(makeFile("a.svg", "image/svg+xml", 10)) as { error: string }).error,
      /PDF, JPG, JPEG o PNG/,
    );
    assert.equal(validateClientePagareFile(makeFile("a.gif", "image/gif", 10)).ok, false);
    assert.equal(
      validateClientePagareFile(
        makeFile("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 10),
      ).ok,
      false,
    );
  });

  it("rechaza extensión incompatible con MIME", () => {
    const result = validateClientePagareFile(makeFile("foto.png", "application/pdf", 10));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /no coincide|PDF, JPG/);
    }
  });

  it("rechaza vacío y permite exactamente 15 MB; rechaza +1 byte", () => {
    assert.equal(validateClientePagareFile(makeFile("a.pdf", "application/pdf", 0)).ok, false);
    const max = CLIENTE_PAGARE_DOCUMENT_CONTRACT.maxBytes;
    assert.equal(validateClientePagareFile(makeFile("a.pdf", "application/pdf", max)).ok, true);
    const over = validateClientePagareFile(makeFile("a.pdf", "application/pdf", max + 1));
    assert.equal(over.ok, false);
    if (!over.ok) assert.match(over.error, /15 MB/);
  });
});

describe("resolveClientePagareUploadMime / path", () => {
  it("resuelve MIME canónicos", () => {
    assert.equal(
      resolveClientePagareUploadMime(makeFile("x.pdf", "application/pdf", 1)),
      "application/pdf",
    );
    assert.equal(
      resolveClientePagareUploadMime(makeFile("x.jpg", "image/jpeg", 1)),
      "image/jpeg",
    );
  });

  it("genera path con cliente_pagare, uuid y sin nombre original", () => {
    const path = buildClientePagareStoragePath({
      organizationId: "11111111-1111-1111-1111-111111111111",
      expedienteId: "22222222-2222-2222-2222-222222222222",
      mimeType: "application/pdf",
      originalFileName: "pagaré con espacios.pdf",
    });
    assert.match(path, /\/cliente_pagare\//);
    assert.ok(!path.includes("pagaré"));
    assert.ok(!path.includes(".."));
    assert.ok(storageObjectKeyLooksSafe(path));
  });
});

describe("UI rules Pagaré", () => {
  it("asesor: sección solo desde etapa 7", () => {
    assert.equal(shouldShowAsesorPagareSection(6), false);
    assert.equal(shouldShowAsesorPagareSection(7), true);
  });

  it("mesa: modos etapa / pendiente / cargado / solo lectura", () => {
    assert.equal(
      resolveMesaPagareUiMode({ etapaActual: 6, puedeOperar: true, hasDocumento: false }),
      "etapa_bloqueada",
    );
    assert.equal(
      resolveMesaPagareUiMode({ etapaActual: 7, puedeOperar: true, hasDocumento: false }),
      "pendiente",
    );
    assert.equal(
      resolveMesaPagareUiMode({ etapaActual: 8, puedeOperar: true, hasDocumento: true }),
      "cargado",
    );
    assert.equal(
      resolveMesaPagareUiMode({ etapaActual: 7, puedeOperar: false, hasDocumento: true }),
      "solo_lectura",
    );
    assert.equal(mesaPagareWriteEnabled("etapa_bloqueada"), false);
    assert.equal(mesaPagareWriteEnabled("cargado"), true);
    assert.equal(canMesaOperatePagare({ etapaActual: 7, puedeOperar: true }), true);
    assert.equal(canMesaOperatePagare({ etapaActual: 6, puedeOperar: true }), false);
  });

  it("findClientePagareFromList solo toma cliente_pagare activo", () => {
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
        tipo_documento: "cliente_pagare",
        id: "p1",
        nombre_original: "pagare.pdf",
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
    const found = findClientePagareFromList(items);
    assert.equal(found?.id, "p1");
    assert.equal(found?.version, 2);
    assert.equal(found?.createdByName, "Mesa Uno");
    assert.equal(findClientePagareFromList([]), null);
  });
});
