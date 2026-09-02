import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENTE_CONSTANCIA_SITUACION_FISCAL_ACCEPT_ATTR,
  CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT,
  CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
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
  buildClienteConstanciaSituacionFiscalStoragePath,
  findClienteConstanciaSituacionFiscalFromList,
  isClienteConstanciaSituacionFiscalPreviewableMime,
  sanitizeConstanciaSituacionFiscalDisplayName,
  validateClienteConstanciaSituacionFiscalFile,
  asesorPuedeEditarConstanciaSituacionFiscal,
} from "./cliente-constancia-situacion-fiscal";
import type { ExpedienteArchivoListItem } from "./map-supabase-expediente-documentos";
import {
  getExpedienteDocumentoAcceptAttr,
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

describe("cliente_constancia_situacion_fiscal contrato y allowlists", () => {
  it("tipo interno canónico y contrato opcional sin gate", () => {
    assert.equal(
      CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      "cliente_constancia_situacion_fiscal",
    );
    assert.equal(CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT.obligatorio, false);
    assert.equal(CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT.esGateAvance, false);
    assert.equal(
      CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT.maxBytes,
      15 * 1024 * 1024,
    );
    assert.equal(CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT.label, "Constancia SAT");
    assert.ok(
      (INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES as readonly string[]).includes(
        CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO as readonly string[]).includes(
        CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_VALIDACION_MESA as readonly string[]).includes(
        CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      ),
    );
    assert.ok(
      !(INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES_SOLO_ASESOR as readonly string[]).includes(
        CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      ),
    );
    assert.notEqual(
      CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      "cliente_constancia_sat",
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
        tipo_documento: CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
        estatus_revision: "faltante",
      },
    ]);
    assert.ok(
      !opc.some(
        (i) => i.tipo_documento === CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      ),
    );

    const soloAsesor = deriveIntegrationDocsChecklistOpcionalesSoloAsesor([
      {
        tipo_documento: CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
        estatus_revision: "faltante",
      },
    ]);
    assert.ok(
      !soloAsesor.some(
        (i) => i.tipo_documento === CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      ),
    );

    const oblig = deriveIntegrationDocsChecklist(resumen);
    assert.equal(oblig.length, 4);
    assert.ok(
      !oblig.some(
        (i) => i.tipo_documento === CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      ),
    );
  });

  it("regresión P090: Pagaré intacto en contrato", () => {
    assert.equal(CLIENTE_PAGARE_DOCUMENT_TIPO, "cliente_pagare");
  });
});

describe("cliente_constancia_situacion_fiscal validación y MIME", () => {
  it("accept=PDF y rechaza zip/imagen", () => {
    assert.equal(CLIENTE_CONSTANCIA_SITUACION_FISCAL_ACCEPT_ATTR, "application/pdf,.pdf");
    assert.equal(
      getExpedienteDocumentoAcceptAttr(CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO),
      "application/pdf,.pdf",
    );

    const pdf = fakeFile({
      name: "constancia.pdf",
      type: "application/pdf",
      size: 1024,
    });
    assert.equal(validateClienteConstanciaSituacionFiscalFile(pdf).ok, true);
    assert.equal(
      validateExpedienteDocumentoUploadFile(
        pdf,
        CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      ).ok,
      true,
    );

    const zip = fakeFile({
      name: "paquete.zip",
      type: "application/zip",
      size: 1024,
    });
    assert.equal(validateClienteConstanciaSituacionFiscalFile(zip).ok, false);
    assert.equal(
      validateExpedienteDocumentoUploadFile(
        zip,
        CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
      ).ok,
      false,
    );
  });

  it("bloquea archivo > 15 MB", () => {
    const big = fakeFile({
      name: "grande.pdf",
      type: "application/pdf",
      size: 15 * 1024 * 1024 + 1,
    });
    const v = validateClienteConstanciaSituacionFiscalFile(big);
    assert.equal(v.ok, false);
    if (!v.ok) assert.match(v.error, /15 MB/);
    assert.equal(
      validateExpedienteDocumentoFile(big, CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO)
        .ok,
      false,
    );
  });

  it("preview solo PDF", () => {
    assert.equal(isClienteConstanciaSituacionFiscalPreviewableMime("application/pdf"), true);
    assert.equal(isClienteConstanciaSituacionFiscalPreviewableMime("image/jpeg"), false);
    assert.equal(isClienteConstanciaSituacionFiscalPreviewableMime("image/png"), false);
    assert.equal(isClienteConstanciaSituacionFiscalPreviewableMime("application/zip"), false);
    assert.equal(
      isClienteConstanciaSituacionFiscalPreviewableMime("application/octet-stream"),
      false,
    );
  });

  it("path seguro con uuid y sin nombre original en key", () => {
    const path = buildClienteConstanciaSituacionFiscalStoragePath({
      organizationId: "00000000-0000-4000-8000-000000000001",
      expedienteId: "00000000-0000-4000-8000-000000000099",
      mimeType: "application/pdf",
      originalFileName: "../../evil.pdf",
    });
    assert.match(path, /\/cliente_constancia_situacion_fiscal\//);
    assert.ok(!path.includes(".."));
    assert.ok(!path.includes("evil"));
  });

  it("sanitiza nombre de presentación", () => {
    assert.equal(
      sanitizeConstanciaSituacionFiscalDisplayName("../a/b\\c.pdf"),
      "_a_b_c.pdf",
    );
  });

  it("findClienteConstanciaSituacionFiscalFromList toma la activa del listado", () => {
    const list: ExpedienteArchivoListItem[] = [
      {
        expediente_id: "e1",
        tipo_documento: CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_TIPO,
        id: "d1",
        nombre_original: "constancia.pdf",
        mime_type: "application/pdf",
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
    const found = findClienteConstanciaSituacionFiscalFromList(list);
    assert.equal(found?.id, "d1");
    assert.equal(found?.version, 2);
    assert.equal(findClienteConstanciaSituacionFiscalFromList([]), null);
  });

  it("ausencia de Constancia SAT no bloquea contrato opcional", () => {
    assert.equal(CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT.obligatorio, false);
    assert.equal(CLIENTE_CONSTANCIA_SITUACION_FISCAL_DOCUMENT_CONTRACT.esGateAvance, false);
    assert.equal(findClienteConstanciaSituacionFiscalFromList([]), null);
  });
});

describe("asesorPuedeEditarConstanciaSituacionFiscal (independiente de monto)", () => {
  it("permite carga sin monto aprobado (ciclo activo o ausente)", () => {
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal("activo"), true);
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal(null), true);
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal(undefined), true);
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal("  Activo  "), true);
  });

  it("también permite con ciclo activo aunque hubiera monto (FE no consulta monto)", () => {
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal("activo"), true);
  });

  it("solo lectura cuando el expediente no está activo", () => {
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal("cancelado"), false);
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal("rechazado"), false);
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal("cerrado"), false);
  });

  it("no usa monto_aprobado ni Pagaré en la firma", () => {
    assert.equal(asesorPuedeEditarConstanciaSituacionFiscal.length, 1);
  });
});
