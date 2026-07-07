import assert from "node:assert/strict";
import test from "node:test";
import {
  CARTA_EMPRESA_DOCUMENT_TIPO,
  isPdfFile,
  PDF_ONLY_UPLOAD_MESSAGE,
  validateExpedienteDocumentoUploadFile,
  validatePdfFile,
} from "@/lib/fileUploadValidation";
import {
  INTEGRATION_DOC_TIPOS_ASESOR_ENVIO,
  INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES,
  integrationDocsCompletos,
} from "@/domain/expediente-archivos/integration-docs-completos";
import {
  asesorPuedeSubirOpcionalFaltantePostMesa,
  asesorPuedeSubirOCorregirDocumento,
} from "@/domain/expediente-archivos/asesor-correccion-post-mesa";

function mockFile(name: string, type: string, size = 1024): File {
  return { name, type, size } as File;
}

const CARTA = CARTA_EMPRESA_DOCUMENT_TIPO;

test("PDF válido con MIME application/pdf", () => {
  const file = mockFile("documento.pdf", "application/pdf");
  assert.equal(isPdfFile(file), true);
  assert.deepEqual(validatePdfFile(file), { ok: true });
});

test("PDF válido con extensión .PDF", () => {
  const file = mockFile("INE Frente.PDF", "application/pdf");
  assert.equal(isPdfFile(file), true);
});

test("JPG rechazado en validación PDF-only", () => {
  const file = mockFile("foto.jpg", "image/jpeg");
  const result = validatePdfFile(file);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /foto\.jpg/i);
});

test("PNG rechazado en validación PDF-only", () => {
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

test("application/pdf sin extensión aceptado", () => {
  const file = mockFile("sin-extension", "application/pdf");
  assert.equal(validatePdfFile(file).ok, true);
});

test("extensión .pdf con MIME vacío aceptado", () => {
  const file = mockFile("carta empresa.pdf", "", 1_500_000);
  assert.equal(isPdfFile(file), true);
  assert.deepEqual(validatePdfFile(file), { ok: true });
});

test("carta empresa: extensión .pdf con application/octet-stream aceptado", () => {
  const file = mockFile("cliente_carta_empresa.pdf", "application/octet-stream", 800_000);
  assert.deepEqual(validateExpedienteDocumentoUploadFile(file, CARTA), { ok: true });
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

test("carta empresa acepta application/pdf", () => {
  const file = mockFile("carta.pdf", "application/pdf");
  assert.deepEqual(validateExpedienteDocumentoUploadFile(file, CARTA), { ok: true });
});

test("carta empresa acepta image/jpeg", () => {
  const file = mockFile("carta.jpg", "image/jpeg");
  assert.deepEqual(validateExpedienteDocumentoUploadFile(file, CARTA), { ok: true });
});

test("carta empresa acepta image/png", () => {
  const file = mockFile("carta.png", "image/png");
  assert.deepEqual(validateExpedienteDocumentoUploadFile(file, CARTA), { ok: true });
});

test("carta empresa acepta image/webp", () => {
  const file = mockFile("carta.webp", "image/webp");
  assert.deepEqual(validateExpedienteDocumentoUploadFile(file, CARTA), { ok: true });
});

test("carta empresa acepta .jpg con MIME vacío", () => {
  const file = mockFile("carta.jpg", "", 500_000);
  assert.deepEqual(validateExpedienteDocumentoUploadFile(file, CARTA), { ok: true });
});

test("carta empresa acepta .pdf con MIME vacío", () => {
  const file = mockFile("carta.pdf", "", 500_000);
  assert.deepEqual(validateExpedienteDocumentoUploadFile(file, CARTA), { ok: true });
});

test("carta empresa rechaza DOCX", () => {
  const file = mockFile(
    "carta.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(validateExpedienteDocumentoUploadFile(file, CARTA).ok, false);
});

test("comprobante domicilio rechaza JPG", () => {
  const file = mockFile("foto.jpg", "image/jpeg");
  assert.equal(
    validateExpedienteDocumentoUploadFile(file, "cliente_comprobante_domicilio").ok,
    false,
  );
});

test("estado de cuenta rechaza JPG", () => {
  const file = mockFile("foto.jpg", "image/jpeg");
  assert.equal(
    validateExpedienteDocumentoUploadFile(file, "cliente_estado_cuenta").ok,
    false,
  );
});

test("obligatorios siguen siendo 4", () => {
  assert.equal(INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.length, 4);
});

test("carta empresa sigue opcional", () => {
  assert.ok(INTEGRATION_DOC_TIPOS_ASESOR_OPCIONALES.includes(CARTA));
  const resumen = [
    ...INTEGRATION_DOC_TIPOS_ASESOR_ENVIO.map((tipo) => ({
      tipo_documento: tipo,
      estatus_revision: "subido" as const,
    })),
  ];
  assert.equal(integrationDocsCompletos(resumen), true);
  assert.equal(
    integrationDocsCompletos([
      ...resumen,
      { tipo_documento: CARTA, estatus_revision: "faltante" },
    ]),
    true,
  );
});

test("carta empresa habilitada post-Mesa si falta", () => {
  assert.equal(
    asesorPuedeSubirOpcionalFaltantePostMesa(true, "faltante", CARTA),
    true,
  );
});

test("carta empresa existente puede reemplazarse post-Mesa", () => {
  assert.equal(
    asesorPuedeSubirOCorregirDocumento(true, "subido", CARTA),
    true,
  );
});
