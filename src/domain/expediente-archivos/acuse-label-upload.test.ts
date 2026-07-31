import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOCUMENTO_CATALOGO_MAP,
  listDocumentosCatalogoForStage,
} from "./types";
import {
  listRetencionUploadsForOpcion,
  RETENCION_DOC_LABEL,
  retencionDocListoParaEnvioMesa,
} from "./retencion-acuse-aviso";
import {
  getExpedienteDocumentoAcceptAttr,
  RETENCION_PRINCIPAL_ACCEPT_ATTR,
  RETENCION_PRINCIPAL_UPLOAD_MESSAGE,
  validateExpedienteDocumentoUploadFile,
} from "@/lib/fileUploadValidation";
import {
  isArchivoPreviewImageMime,
  isArchivoPreviewPdfMime,
} from "@/lib/archivoPreviewMime";

const TIPO = "retencion_acuse_con_sello" as const;

function mockFile(name: string, type: string, size = 1024): File {
  return { name, type, size } as File;
}

describe("Acuse — etiqueta visible + formatos (sin renombrar tipo interno)", () => {
  it("identificador interno histórico intacto", () => {
    assert.equal(TIPO, "retencion_acuse_con_sello");
    assert.equal(DOCUMENTO_CATALOGO_MAP[TIPO].tipo, "retencion_acuse_con_sello");
    assert.ok(
      listDocumentosCatalogoForStage({ etapaId: 8 }).some((d) => d.tipo === TIPO),
    );
  });

  it("UI muestra Acuse, nunca Acuse Apodaca", () => {
    assert.equal(RETENCION_DOC_LABEL[TIPO], "Acuse");
    const uploads = listRetencionUploadsForOpcion("con_sello");
    assert.equal(uploads[0]?.label, "Acuse");
    assert.equal(`Subir ${uploads[0]?.label}`, "Subir Acuse");
    assert.equal(`Reemplazar ${uploads[0]?.label}`, "Reemplazar Acuse");
    assert.doesNotMatch(uploads[0]!.label, /Apodaca/i);
    assert.doesNotMatch(DOCUMENTO_CATALOGO_MAP[TIPO].label, /Apodaca/i);
  });

  it("accept + mensaje de error alineados a PDF/JPG/PNG", () => {
    assert.equal(getExpedienteDocumentoAcceptAttr(TIPO), RETENCION_PRINCIPAL_ACCEPT_ATTR);
    assert.match(RETENCION_PRINCIPAL_ACCEPT_ATTR, /application\/pdf/);
    assert.match(RETENCION_PRINCIPAL_ACCEPT_ATTR, /image\/jpeg/);
    assert.match(RETENCION_PRINCIPAL_ACCEPT_ATTR, /image\/png/);
    assert.doesNotMatch(RETENCION_PRINCIPAL_ACCEPT_ATTR, /webp/i);
    assert.equal(RETENCION_PRINCIPAL_UPLOAD_MESSAGE, "Sube un archivo PDF, JPG o PNG.");
  });

  it("acepta PDF, JPG, JPEG y PNG; rechaza MIME no permitido y extensión falsa", () => {
    assert.equal(
      validateExpedienteDocumentoUploadFile(mockFile("a.pdf", "application/pdf"), TIPO).ok,
      true,
    );
    assert.equal(
      validateExpedienteDocumentoUploadFile(mockFile("a.jpg", "image/jpeg"), TIPO).ok,
      true,
    );
    assert.equal(
      validateExpedienteDocumentoUploadFile(mockFile("a.jpeg", "image/jpeg"), TIPO).ok,
      true,
    );
    assert.equal(
      validateExpedienteDocumentoUploadFile(mockFile("a.png", "image/png"), TIPO).ok,
      true,
    );
    assert.equal(
      validateExpedienteDocumentoUploadFile(mockFile("a.webp", "image/webp"), TIPO).ok,
      false,
    );
    assert.equal(
      validateExpedienteDocumentoUploadFile(mockFile("a.gif", "image/gif"), TIPO).ok,
      false,
    );
    assert.equal(
      validateExpedienteDocumentoUploadFile(mockFile("a.pdf", "image/jpeg"), TIPO).ok,
      false,
    );
    assert.equal(
      validateExpedienteDocumentoUploadFile(mockFile("a.png", "application/pdf"), TIPO).ok,
      false,
    );
  });

  it("preview PDF e imagen (JPG/PNG) siguen soportados", () => {
    assert.equal(isArchivoPreviewPdfMime("application/pdf"), true);
    assert.equal(isArchivoPreviewImageMime("image/jpeg"), true);
    assert.equal(isArchivoPreviewImageMime("image/png"), true);
  });

  it("Acuse válido sigue habilitando el contrato de envío/avance a firmas", () => {
    assert.equal(
      retencionDocListoParaEnvioMesa({
        tipo_documento: TIPO,
        id: "doc-1",
        estatus_revision: "subido",
      }),
      true,
    );
    assert.equal(
      retencionDocListoParaEnvioMesa({
        tipo_documento: TIPO,
        id: null,
        estatus_revision: "faltante",
      }),
      false,
    );
  });

  it("otros documentos no heredan el label Acuse", () => {
    assert.notEqual(RETENCION_DOC_LABEL.retencion_carta_sin_sello, "Acuse");
    assert.notEqual(RETENCION_DOC_LABEL.retencion_aviso_retencion, "Acuse");
  });
});
