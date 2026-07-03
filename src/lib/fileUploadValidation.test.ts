import assert from "node:assert/strict";
import test from "node:test";
import {
  isPdfFile,
  PDF_ONLY_UPLOAD_MESSAGE,
  validateExpedienteDocumentoUploadFile,
  validatePdfFile,
} from "@/lib/fileUploadValidation";

function mockFile(name: string, type: string, size = 1024): File {
  return { name, type, size } as File;
}

test("PDF válido con MIME application/pdf", () => {
  const file = mockFile("documento.pdf", "application/pdf");
  assert.equal(isPdfFile(file), true);
  assert.deepEqual(validatePdfFile(file), { ok: true });
});

test("PDF válido con extensión .PDF", () => {
  const file = mockFile("INE Frente.PDF", "application/pdf");
  assert.equal(isPdfFile(file), true);
});

test("JPG rechazado", () => {
  const file = mockFile("foto.jpg", "image/jpeg");
  const result = validatePdfFile(file);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /foto\.jpg/i);
});

test("PNG rechazado", () => {
  const file = mockFile("scan.png", "image/png");
  assert.equal(validatePdfFile(file).ok, false);
});

test("DOCX rechazado", () => {
  const file = mockFile(
    "doc.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(validatePdfFile(file).ok, false);
});

test("archivo sin extensión rechazado", () => {
  const file = mockFile("sin-extension", "application/pdf");
  assert.equal(validatePdfFile(file).ok, false);
});

test("MIME correcto pero extensión incorrecta rechazado", () => {
  const file = mockFile("archivo.jpg", "application/pdf");
  assert.equal(validatePdfFile(file).ok, false);
});

test("extensión .pdf pero MIME incorrecto rechazado", () => {
  const file = mockFile("archivo.pdf", "image/jpeg");
  assert.equal(validatePdfFile(file).ok, false);
});

test("archivo vacío rechazado", () => {
  const file = mockFile("vacio.pdf", "application/pdf", 0);
  assert.equal(validatePdfFile(file).ok, false);
});

test("mensaje base PDF", () => {
  const result = validatePdfFile(mockFile("x.png", "image/png"));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message, '"x.png" no es válido. Solo se permiten archivos PDF.');
  }
  assert.equal(PDF_ONLY_UPLOAD_MESSAGE.includes("PDF"), true);
});

test("INE frente acepta JPG", () => {
  const file = mockFile("ine.jpg", "image/jpeg");
  assert.deepEqual(validateExpedienteDocumentoUploadFile(file, "cliente_ine_frente"), {
    ok: true,
  });
});

test("comprobante domicilio rechaza JPG", () => {
  const file = mockFile("foto.jpg", "image/jpeg");
  assert.equal(
    validateExpedienteDocumentoUploadFile(file, "cliente_comprobante_domicilio").ok,
    false,
  );
});
