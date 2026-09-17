import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const previewPath = join(
  process.cwd(),
  "src/components/mesa-control/MesaInfonavitSourceDocumentPreview.tsx",
);
const formPath = join(
  process.cwd(),
  "src/components/mesa-control/MesaInfonavitGenerarDocumentosForm.tsx",
);
const mappingPath = join(
  process.cwd(),
  "src/domain/document-extractions/infonavit-source-preview.ts",
);

const previewSrc = readFileSync(previewPath, "utf8");
const formSrc = readFileSync(formPath, "utf8");
const mappingSrc = readFileSync(mappingPath, "utf8");

describe("P4A MesaInfonavitSourceDocumentPreview contrato", () => {
  it("11–12. createObjectURL + revokeObjectURL al cambiar y unmount", () => {
    assert.match(previewSrc, /URL\.createObjectURL/);
    assert.match(previewSrc, /URL\.revokeObjectURL/);
    // revoke al reemplazar preview y en cleanup de preview?.url
    const revokeCount = previewSrc.split("URL.revokeObjectURL").length - 1;
    assert.ok(revokeCount >= 3, `esperaba ≥3 revoke, got ${revokeCount}`);
  });

  it("13. no URL pública permanente / signed getPublicUrl", () => {
    assert.doesNotMatch(previewSrc, /getPublicUrl/);
    assert.doesNotMatch(previewSrc, /createSignedUrl/);
    assert.doesNotMatch(previewSrc, /https:\/\/.*supabase/);
    assert.match(previewSrc, /getArchivoBlob/);
  });

  it("reutiliza MesaArchivoPreviewDialog + listByExpediente current", () => {
    assert.match(previewSrc, /MesaArchivoPreviewDialog/);
    assert.match(previewSrc, /listByExpediente/);
    assert.match(previewSrc, /rowMasRecientePorTipoDocumento/);
    assert.match(previewSrc, /Documento no disponible/);
    assert.match(previewSrc, /Abrir vista grande/);
  });

  it("tipos exactos INE / estado cuenta / comprobante", () => {
    for (const tipo of [
      "cliente_ine_frente",
      "cliente_ine_reverso",
      "cliente_estado_cuenta",
      "cliente_comprobante_domicilio",
    ]) {
      assert.match(previewSrc, new RegExp(tipo));
      assert.match(mappingSrc, new RegExp(tipo));
    }
  });

  it("14. formulario integra preview sin bloquear captura", () => {
    assert.match(formSrc, /MesaInfonavitSourceDocumentPreview/);
    assert.match(formSrc, /mesa-infonavit-generar-layout/);
    assert.match(formSrc, /focusSource\("nombres"\)/);
    assert.match(formSrc, /focusSource\("rfc"\)/);
    assert.match(formSrc, /focusSource\("clabeDerechohabiente"\)/);
    assert.match(formSrc, /focusSource\("viviendaCalle"\)/);
    assert.match(formSrc, /xl:sticky/);
    // generación intacta
    assert.match(formSrc, /mesa_generar_infonavit_documentos/);
    assert.match(formSrc, /handleGenerate/);
  });

  it("15. P0 T31/T32 siguen blank (sin reintroducir captura)", () => {
    assert.doesNotMatch(formSrc, /% para titulación/);
    assert.doesNotMatch(formSrc, /CLABE de la notaría/);
    assert.match(formSrc, /normalizeDestinoRecursosForCapture/);
    assert.match(formSrc, /porcentajeTitulacion:\s*""/);
    assert.match(formSrc, /clabeNotaria:\s*""/);
  });

  it("16. P1 CLABE sigue validando", () => {
    assert.match(formSrc, /validateClabeDerechohabienteForGenerate/);
    assert.match(formSrc, /isValidClabeMexico/);
  });

  it("17. generación P189 no cambia (RPC + payload builder)", () => {
    assert.match(formSrc, /buildMesaInfonavitGeneratePayload/);
    assert.match(formSrc, /mesa_generar_infonavit_documentos/);
    assert.doesNotMatch(formSrc, /enqueue_document_extraction/);
    assert.doesNotMatch(formSrc, /OpenAI|Document AI|Azure|ocr/i);
    assert.doesNotMatch(previewSrc, /enqueue_document_extraction/);
    assert.doesNotMatch(previewSrc, /OpenAI|Document AI|Azure|ocr/i);
  });

  it("no autofill / no mutate cliente_datos desde preview", () => {
    assert.doesNotMatch(previewSrc, /cliente_datos/);
    assert.doesNotMatch(previewSrc, /updateCliente/);
    assert.doesNotMatch(previewSrc, /\bautofill\b/i);
    assert.doesNotMatch(mappingSrc, /extractRfc|extractClabe|enqueue_document_extraction/);
    assert.doesNotMatch(previewSrc, /extractRfc|extractClabe|enqueue_document_extraction/);
  });
});
