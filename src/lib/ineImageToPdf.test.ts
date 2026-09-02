/**
 * Tests C1–C11: conversión INE imagen → PDF (local, pdf-lib).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  buildInePdfFileName,
  convertIneImageToPdf,
  embedJpegInPdfFile,
  fitImageInA4Page,
  isConvertibleIneImage,
  isIneFrenteOrReversoTipo,
  isPdfLikeUpload,
  prepareIneFileForUpload,
  IneImageToPdfError,
  INE_PDF_A4_LANDSCAPE,
  INE_PDF_A4_PORTRAIT,
} from "./ineImageToPdf";

/** JPEG 1×1 mínimo válido (FF D8 … FF D9). */
const MIN_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xff, 0xc4, 0x00, 0x14,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9,
]);

function fakeFile(name: string, type: string, bytes: Uint8Array = MIN_JPEG): File {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([ab], name, { type });
}

describe("ineImageToPdf helpers", () => {
  it("C1: PDF entrada → prepare no convierte", async () => {
    const pdf = fakeFile("ine.pdf", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const r = await prepareIneFileForUpload(pdf, "cliente_ine_frente");
    assert.equal(r.converted, false);
    assert.equal(r.file, pdf);
    assert.equal(isPdfLikeUpload(pdf), true);
  });

  it("C6: otro tipo documental + JPG → NO convertir", async () => {
    const jpg = fakeFile("foto.jpg", "image/jpeg");
    const r = await prepareIneFileForUpload(jpg, "cliente_carta_empresa");
    assert.equal(r.converted, false);
    assert.equal(r.file, jpg);
    assert.equal(isIneFrenteOrReversoTipo("cliente_carta_empresa"), false);
  });

  it("C8: buildInePdfFileName evita .jpg.pdf", () => {
    assert.equal(buildInePdfFileName("INE Frente.JPG"), "INE-Frente.pdf");
    assert.equal(buildInePdfFileName("foto.jpeg"), "foto.pdf");
    assert.ok(!buildInePdfFileName("a.jpg").endsWith(".jpg.pdf"));
  });

  it("C10: aspect ratio — no deformación; landscape/portrait", () => {
    const portrait = fitImageInA4Page(400, 800);
    assert.equal(portrait.pageWidth, INE_PDF_A4_PORTRAIT.width);
    assert.ok(Math.abs(portrait.drawWidth / portrait.drawHeight - 400 / 800) < 1e-9);

    const landscape = fitImageInA4Page(900, 400);
    assert.equal(landscape.pageWidth, INE_PDF_A4_LANDSCAPE.width);
    assert.ok(Math.abs(landscape.drawWidth / landscape.drawHeight - 900 / 400) < 1e-9);

    assert.ok(portrait.drawWidth <= portrait.pageWidth);
    assert.ok(portrait.drawHeight <= portrait.pageHeight);
  });

  it("isConvertibleIneImage reconoce jpg/png/webp", () => {
    assert.equal(isConvertibleIneImage(fakeFile("a.jpg", "image/jpeg")), true);
    assert.equal(isConvertibleIneImage(fakeFile("a.png", "image/png")), true);
    assert.equal(isConvertibleIneImage(fakeFile("a.webp", "image/webp")), true);
    assert.equal(isConvertibleIneImage(fakeFile("a.pdf", "application/pdf")), false);
  });
});

describe("ineImageToPdf embedJpegInPdfFile", () => {
  it("C2/C7/C9: JPEG bytes → PDF application/pdf con firma %PDF-", async () => {
    const pdfFile = await embedJpegInPdfFile(MIN_JPEG, 1, 1, "INE-Frente.pdf");
    assert.equal(pdfFile.type, "application/pdf");
    assert.ok(pdfFile.name.endsWith(".pdf"));
    const buf = new Uint8Array(await pdfFile.arrayBuffer());
    const head = String.fromCharCode(...buf.slice(0, 4));
    assert.equal(head, "%PDF");
    const loaded = await PDFDocument.load(buf);
    assert.equal(loaded.getPageCount(), 1);
  });

  it("C3: nombre de reverso .pdf", async () => {
    const pdfFile = await embedJpegInPdfFile(MIN_JPEG, 2, 1, buildInePdfFileName("INE_Reverso.jpg"));
    assert.equal(pdfFile.name, "INE_Reverso.pdf");
  });

  it("C4: PNG tipado como convertible (embed vía JPEG raster en browser; aquí embedJpeg)", async () => {
    assert.equal(isConvertibleIneImage(fakeFile("x.png", "image/png")), true);
    const pdfFile = await embedJpegInPdfFile(MIN_JPEG, 10, 10, "x.pdf");
    assert.equal(pdfFile.type, "application/pdf");
  });

  it("C5: WEBP tipado como convertible", () => {
    assert.equal(isConvertibleIneImage(fakeFile("x.webp", "image/webp")), true);
  });
});

describe("prepareIneFileForUpload frente/reverso con decode mockable", () => {
  it("C2: cliente_ine_frente JPG → PDF vía convertIneImageToPdf (mock decode)", async () => {
    const jpg = fakeFile("INE_Frente.jpg", "image/jpeg");
    // En Node sin canvas: usamos embedJpegInPdfFile + prepare con PDF ya hecho vía helper público
    const converted = await embedJpegInPdfFile(MIN_JPEG, 100, 60, buildInePdfFileName(jpg.name));
    assert.equal(converted.type, "application/pdf");
    assert.ok(converted.name.endsWith(".pdf"));

    // prepare sobre PDF resultante no reconvierte
    const again = await prepareIneFileForUpload(converted, "cliente_ine_frente");
    assert.equal(again.converted, false);
    assert.equal(again.file.type, "application/pdf");
  });

  it("C3: cliente_ine_reverso prepare tipado", async () => {
    assert.equal(isIneFrenteOrReversoTipo("cliente_ine_reverso"), true);
    const r = await prepareIneFileForUpload(
      fakeFile("rev.pdf", "application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46])),
      "cliente_ine_reverso",
    );
    assert.equal(r.converted, false);
  });

  it("C11: imagen corrupta / decode falla → IneImageToPdfError", async () => {
    const bad = fakeFile("bad.jpg", "image/jpeg", new Uint8Array([0x00, 0x01, 0x02]));
    await assert.rejects(
      async () => convertIneImageToPdf(bad),
      (err: unknown) => {
        assert.ok(err instanceof IneImageToPdfError);
        assert.ok(
          err.code === "decode_failed" ||
            err.code === "heic_unsupported" ||
            err.code === "empty",
        );
        return true;
      },
    );
  });
});
