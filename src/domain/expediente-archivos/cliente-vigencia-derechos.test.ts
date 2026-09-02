import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENTE_VIGENCIA_DERECHOS_ACCEPT_ATTR,
  CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT,
  CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
  CLIENTE_PAGARE_DOCUMENT_TIPO,
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES,
  INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES_SOLO_ASESOR,
  INTEGRATION_DOC_TIPOS_VALIDACION_MESA,
  countIntegrationDocsPresentes,
  deriveIntegrationDocsChecklist,
  deriveIntegrationDocsChecklistOpcionales,
  deriveIntegrationDocsChecklistOpcionalesSoloAsesor,
  integrationDocsCompletos,
} from "./index";
import {
  buildClienteVigenciaDerechosStoragePath,
  findClienteVigenciaDerechosFromList,
  isClienteVigenciaDerechosPreviewableMime,
  resolveClienteVigenciaDerechosUploadMime,
  sanitizeVigenciaDerechosDisplayName,
  validateClienteVigenciaDerechosFile,
  asesorPuedeEditarVigenciaDerechos,
} from "./cliente-vigencia-derechos";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";
import {
  getExpedienteDocumentoAcceptAttr,
  resolveExpedienteDocumentoUploadMime,
  validateExpedienteDocumentoUploadFile,
} from "@/lib/fileUploadValidation";
import { validateExpedienteDocumentoFile } from "./upload-constraints";

function fakeFile(input: {
  name: string;
  type: string;
  size: number;
}): File {
  const blob = new Blob([new Uint8Array(Math.min(input.size, 64))], {
    type: input.type,
  });
  const file = new File([blob], input.name, { type: input.type });
  Object.defineProperty(file, "size", { value: input.size });
  return file;
}

describe("cliente_vigencia_derechos contrato y allowlists", () => {
  it("tipo interno canónico y contrato opcional sin gate", () => {
    assert.equal(CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO, "cliente_vigencia_derechos");
    assert.equal(CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT.obligatorio, false);
    assert.equal(CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT.esGateAvance, false);
    assert.equal(CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT.maxBytes, 15 * 1024 * 1024);
    assert.equal(CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT.label, "Vigencia de derechos");
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES as readonly string[]).includes(
        CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes(
        CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_VALIDACION_MESA as readonly string[]).includes(
        CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES_SOLO_ASESOR as readonly string[]).includes(
        CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
      ),
    );
  });

  it("no aparece en checklists ni altera progreso de envío", () => {
    const resumen = INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map((tipo) => ({
      tipo_documento: tipo,
      estatus_revision: "subido" as const,
    }));
    assert.equal(countIntegrationDocsPresentes(resumen), 4);
    assert.equal(integrationDocsCompletos(resumen), true);

    const opc = deriveIntegrationDocsChecklistOpcionales([
      ...resumen,
      {
        tipo_documento: CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
        estatus_revision: "faltante",
      },
    ]);
    assert.ok(!opc.some((i) => i.tipo_documento === CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO));

    const soloAsesor = deriveIntegrationDocsChecklistOpcionalesSoloAsesor([
      {
        tipo_documento: CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
        estatus_revision: "faltante",
      },
    ]);
    assert.ok(
      !soloAsesor.some((i) => i.tipo_documento === CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO),
    );

    const oblig = deriveIntegrationDocsChecklist(resumen);
    assert.equal(oblig.length, 4);
    assert.ok(!oblig.some((i) => i.tipo_documento === CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO));
  });

  it("regresión P090: Pagaré intacto en contrato", () => {
    assert.equal(CLIENTE_PAGARE_DOCUMENT_TIPO, "cliente_pagare");
  });
});

describe("cliente_vigencia_derechos validación y MIME", () => {
  it("accept=*/\* y acepta zip/octet-stream", () => {
    assert.equal(CLIENTE_VIGENCIA_DERECHOS_ACCEPT_ATTR, "*/*");
    assert.equal(
      getExpedienteDocumentoAcceptAttr(CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO),
      "*/*",
    );

    const zip = fakeFile({
      name: "paquete.zip",
      type: "application/zip",
      size: 1024,
    });
    assert.equal(validateClienteVigenciaDerechosFile(zip).ok, true);
    assert.equal(
      validateExpedienteDocumentoUploadFile(zip, CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO).ok,
      true,
    );
    assert.equal(
      resolveExpedienteDocumentoUploadMime(zip, CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO),
      "application/zip",
    );

    const raw = fakeFile({
      name: "binario",
      type: "",
      size: 10,
    });
    assert.equal(resolveClienteVigenciaDerechosUploadMime(raw), "application/octet-stream");
    assert.equal(
      resolveExpedienteDocumentoUploadMime(raw, CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO),
      "application/octet-stream",
    );

    const html = fakeFile({
      name: "x.html",
      type: "text/html",
      size: 20,
    });
    assert.equal(resolveClienteVigenciaDerechosUploadMime(html), "application/octet-stream");
  });

  it("bloquea archivo > 15 MB", () => {
    const big = fakeFile({
      name: "grande.bin",
      type: "application/octet-stream",
      size: 15 * 1024 * 1024 + 1,
    });
    const v = validateClienteVigenciaDerechosFile(big);
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.error, /15 MB/);
    assert.equal(
      validateExpedienteDocumentoFile(big, CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO).ok,
      false,
    );
  });

  it("preview solo PDF/JPG/PNG/WEBP; no HTML/SVG/DOCX/ZIP", () => {
    assert.equal(isClienteVigenciaDerechosPreviewableMime("application/pdf"), true);
    assert.equal(isClienteVigenciaDerechosPreviewableMime("image/jpeg"), true);
    assert.equal(isClienteVigenciaDerechosPreviewableMime("image/png"), true);
    assert.equal(isClienteVigenciaDerechosPreviewableMime("image/webp"), true);
    assert.equal(isClienteVigenciaDerechosPreviewableMime("image/svg+xml"), false);
    assert.equal(isClienteVigenciaDerechosPreviewableMime("text/html"), false);
    assert.equal(
      isClienteVigenciaDerechosPreviewableMime(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
      false,
    );
    assert.equal(isClienteVigenciaDerechosPreviewableMime("application/zip"), false);
    assert.equal(isClienteVigenciaDerechosPreviewableMime("application/octet-stream"), false);
  });

  it("path seguro con uuid y sin nombre original en key", () => {
    const path = buildClienteVigenciaDerechosStoragePath({
      organizationId: "00000000-0000-4000-8000-000000000001",
      expedienteId: "00000000-0000-4000-8000-000000000099",
      mimeType: "application/zip",
      originalFileName: "../../evil.zip",
    });
    assert.match(path, /\/cliente_vigencia_derechos\//);
    assert.ok(!path.includes(".."));
    assert.ok(!path.includes("evil"));
  });

  it("sanitiza nombre de presentación", () => {
    assert.equal(sanitizeVigenciaDerechosDisplayName("../a/b\\c.zip"), "_a_b_c.zip");
  });

  it("findClienteVigenciaDerechosFromList toma la activa del listado", () => {
    const list: ExpedienteArchivoListItem[] = [
      {
        expediente_id: "e1",
        tipo_documento: CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_TIPO,
        id: "d1",
        nombre_original: "foto.jpg",
        mime_type: "image/jpeg",
        size_bytes: 100,
        version: 2,
        created_at: "2026-07-22T00:00:00.000Z",
        uploaded_by_role: "asesor",
        uploaded_by_email: "a@x.com",
        uploaded_by_name: "A",
        estatus_revision: "subido",
        comentario_mesa: null,
      },
    ];
    const found = findClienteVigenciaDerechosFromList(list);
    assert.equal(found?.id, "d1");
    assert.equal(found?.version, 2);
    assert.equal(findClienteVigenciaDerechosFromList([]), null);
  });

  it("ausencia de vigencia de derechos no bloquea contrato opcional", () => {
    assert.equal(CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT.obligatorio, false);
    assert.equal(CLIENTE_VIGENCIA_DERECHOS_DOCUMENT_CONTRACT.esGateAvance, false);
    assert.equal(findClienteVigenciaDerechosFromList([]), null);
  });
});

describe("asesorPuedeEditarVigenciaDerechos (independiente de monto)", () => {
  it("permite carga sin monto aprobado (ciclo activo o ausente)", () => {
    assert.equal(asesorPuedeEditarVigenciaDerechos("activo"), true);
    assert.equal(asesorPuedeEditarVigenciaDerechos(null), true);
    assert.equal(asesorPuedeEditarVigenciaDerechos(undefined), true);
    assert.equal(asesorPuedeEditarVigenciaDerechos("  Activo  "), true);
  });

  it("también permite con ciclo activo aunque hubiera monto (FE no consulta monto)", () => {
    assert.equal(asesorPuedeEditarVigenciaDerechos("activo"), true);
  });

  it("solo lectura cuando el expediente no está activo", () => {
    assert.equal(asesorPuedeEditarVigenciaDerechos("cancelado"), false);
    assert.equal(asesorPuedeEditarVigenciaDerechos("rechazado"), false);
    assert.equal(asesorPuedeEditarVigenciaDerechos("cerrado"), false);
  });

  it("no usa monto_aprobado ni Pagaré en la firma", () => {
    assert.equal(asesorPuedeEditarVigenciaDerechos.length, 1);
  });
});
