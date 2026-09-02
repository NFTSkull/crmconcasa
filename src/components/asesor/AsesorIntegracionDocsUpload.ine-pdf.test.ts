/**
 * F1–F7: UI INE conversión automática (hints / status / accept).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getExpedienteDocumentoAcceptAttr,
  isIneImageDocumentTipo,
} from "@/lib/fileUploadValidation";
import {
  INE_IMAGE_CONVERTING_STATUS,
  INE_IMAGE_TO_PDF_HINT,
  INE_IMAGE_UPLOADING_STATUS,
  isConvertibleIneImage,
} from "@/lib/ineImageToPdf";

describe("AsesorIntegracionDocsUpload INE UI contract", () => {
  const uploadSrc = readFileSync(
    join(process.cwd(), "src/components/asesor/AsesorIntegracionDocsUpload.tsx"),
    "utf8",
  );
  const dropzoneSrc = readFileSync(
    join(process.cwd(), "src/components/documents/DocumentDropzone.tsx"),
    "utf8",
  );

  it("F1: INE input permite JPG (accept)", () => {
    const accept = getExpedienteDocumentoAcceptAttr("cliente_ine_frente");
    assert.match(accept, /image\/jpeg|\.jpg/i);
    assert.match(accept, /application\/pdf|\.pdf/i);
    assert.equal(isIneImageDocumentTipo("cliente_ine_frente"), true);
    assert.equal(isIneImageDocumentTipo("cliente_ine_reverso"), true);
  });

  it("F2: copy indica conversión automática", () => {
    assert.match(uploadSrc, /INE_IMAGE_TO_PDF_HINT/);
    assert.match(INE_IMAGE_TO_PDF_HINT, /convertiremos automáticamente a PDF/i);
  });

  it("F3: JPG muestra estado converting", () => {
    assert.match(uploadSrc, /INE_IMAGE_CONVERTING_STATUS/);
    assert.equal(INE_IMAGE_CONVERTING_STATUS, "Convirtiendo imagen a PDF…");
    assert.match(dropzoneSrc, /busyLabel/);
  });

  it("F4: success continúa a upload (PDF listo · subiendo)", () => {
    assert.match(uploadSrc, /INE_IMAGE_UPLOADING_STATUS/);
    assert.equal(INE_IMAGE_UPLOADING_STATUS, "PDF listo · subiendo…");
    assert.match(uploadSrc, /prepareIneFileForUpload/);
  });

  it("F5: conversion error visible", () => {
    assert.match(uploadSrc, /isIneImageToPdfError/);
    assert.match(uploadSrc, /setErrorsByTipo/);
  });

  it("F6: PDF no muestra conversión innecesaria", () => {
    const pdf = { name: "a.pdf", type: "application/pdf", size: 10 } as File;
    assert.equal(isConvertibleIneImage(pdf), false);
    assert.match(uploadSrc, /isConvertibleIneImage\(file\)/);
  });

  it("F7: otros docs no cambian (carta/apodaca hints)", () => {
    assert.match(uploadSrc, /NOTIFICACION_APODACA_UPLOAD_HINT/);
    assert.equal(isIneImageDocumentTipo("cliente_carta_empresa"), false);
    const cartaAccept = getExpedienteDocumentoAcceptAttr("cliente_carta_empresa");
    assert.match(cartaAccept, /image\/jpeg|\.jpg/i);
  });
});
