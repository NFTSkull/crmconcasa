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
const dialogPath = join(
  process.cwd(),
  "src/components/mesa-control/MesaArchivoPreviewDialog.tsx",
);

const previewSrc = readFileSync(previewPath, "utf8");
const formSrc = readFileSync(formPath, "utf8");
const mappingSrc = readFileSync(mappingPath, "utf8");
const dialogSrc = readFileSync(dialogPath, "utf8");

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

  it("visor de imagen permite zoom hasta 200% y rotación manual", () => {
    assert.match(dialogSrc, /Math\.min\(2, value \+ 0\.25\)/);
    assert.match(dialogSrc, /zoomPercent/);
    assert.match(dialogSrc, /Girar izq\./);
    assert.match(dialogSrc, /Girar der\./);
    assert.match(dialogSrc, /rotate\(\$\{rotation\}deg\)/);
    assert.match(previewSrc, /cursor-zoom-in/);
    assert.match(previewSrc, /setModalOpen\(true\)/);
  });

  it("INE tiene zoom y giro inline sin obligar a abrir modal", () => {
    assert.match(previewSrc, /infonavit-inline-ine-controls/);
    assert.match(previewSrc, /infonavit-inline-ine-image/);
    assert.match(previewSrc, /Math\.min\(4, value \+ 0\.25\)/);
    assert.match(previewSrc, /Girar izq\./);
    assert.match(previewSrc, /Girar der\./);
    assert.match(previewSrc, /rotate\(\$\{inlineIneRotation\}deg\)/);
    assert.match(previewSrc, /isInlineIneImage/);
    assert.match(previewSrc, /cliente_ine_frente/);
    assert.match(previewSrc, /cliente_ine_reverso/);
  });

  it("INE inline: object-contain a 100% sin object-cover ni width forzado que recorte", () => {
    assert.match(previewSrc, /data-inline-ine-fit="contain"/);
    assert.match(previewSrc, /infonavit-inline-ine-stage/);
    assert.match(previewSrc, /max-h-full max-w-full object-contain/);
    assert.match(previewSrc, /overflow-auto overscroll-contain/);
    assert.match(previewSrc, /tabIndex=\{0\}/);
    assert.doesNotMatch(previewSrc, /object-cover/);
    // El <img> no fuerza width% ni maxWidth:none (eso recortaba en zoom 100%).
    // El stage sí escala con zoom (layout) — eso es correcto.
    const imgBlock = previewSrc.match(
      /data-inline-ine-fit="contain"[\s\S]{0,280}style=\{\{[\s\S]{0,200}\}\}/,
    );
    assert.ok(imgBlock, "bloque style del img inline INE");
    assert.doesNotMatch(imgBlock[0]!, /width:/);
    assert.doesNotMatch(imgBlock[0]!, /maxWidth:\s*"none"/);
    assert.match(previewSrc, /Frente/);
    assert.match(previewSrc, /Reverso/);
    assert.match(previewSrc, /Abrir vista grande/);
    assert.match(previewSrc, /Restablecer/);
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
    assert.match(formSrc, /infonavit-source-section-identidad/);
    assert.match(formSrc, /infonavit-source-section-vivienda/);
    assert.match(formSrc, /infonavit-source-section-clabe/);
    assert.match(formSrc, /infonavit-source-preview-vivienda/);
    assert.match(formSrc, /infonavit-source-preview-clabe/);
    assert.match(formSrc, /xl:grid-cols-\[minmax\(0,1fr\)_360px\]/);
    assert.match(formSrc, /Nombre\(s\) \*/);
    assert.match(formSrc, /1\. Identificación de la persona derechohabiente/);
    assert.doesNotMatch(formSrc, /forceOpenSignal=/);
    assert.doesNotMatch(formSrc, /xl:sticky/);
    // No grid global envolviendo todo el formulario
    assert.doesNotMatch(
      formSrc,
      /data-testid="mesa-infonavit-generar-layout"[\s\S]{0,120}xl:grid-cols-\[minmax\(0,1\.2fr\)/,
    );
    // generación intacta
    assert.match(formSrc, /mesa_generar_infonavit_documentos/);
    assert.match(formSrc, /handleGenerate/);
  });

  it("Número identificación reaplica automáticamente el reverso de la INE en cada focus", () => {
    assert.match(formSrc, /field === "identificacionNumero"/);
    assert.match(formSrc, /setRequestedIneSide\("reverso"\)/);
    assert.match(formSrc, /setRequestedIneSideVersion\(\(value\) => value \+ 1\)/);
    assert.match(formSrc, /focusSource\("identificacionNumero"\)/);
    assert.match(formSrc, /requestedIneSideVersion=\{requestedIneSideVersion\}/);
    assert.match(previewSrc, /requestedIneSideVersion/);
    assert.match(
      previewSrc,
      /\[context, requestedIneSide, requestedIneSideVersion\]/,
    );
  });

  it("visor de identidad no vuelve a recortarse por max-height del aside", () => {
    assert.match(formSrc, /sourceContext === "identidad"[\s\S]{0,100}"max-h-none"/);
    assert.doesNotMatch(
      formSrc,
      /sourceContext === "identidad"[\s\S]{0,240}className="max-h-\[min\(70vh,720px\)\]"/,
    );
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

  it("17. generación P189 no cambia; P4C OCR queda solo en preparación del draft", () => {
    assert.match(formSrc, /buildMesaInfonavitGeneratePayload/);
    assert.match(formSrc, /mesa_generar_infonavit_documentos/);
    assert.doesNotMatch(formSrc, /enqueue_document_extraction/);
    assert.match(formSrc, /extractDocumentTextViaOcr/);
    assert.doesNotMatch(formSrc, /OpenAI|Document AI|Azure/i);
    assert.doesNotMatch(previewSrc, /enqueue_document_extraction/);
    assert.doesNotMatch(previewSrc, /OpenAI|Document AI|Azure/i);
  });

  it("no autofill / no mutate cliente_datos desde preview", () => {
    assert.doesNotMatch(previewSrc, /cliente_datos/);
    assert.doesNotMatch(previewSrc, /updateCliente/);
    assert.doesNotMatch(previewSrc, /\bautofill\b/i);
    assert.doesNotMatch(mappingSrc, /extractRfc|extractClabe|enqueue_document_extraction/);
    assert.doesNotMatch(previewSrc, /extractRfc|extractClabe|enqueue_document_extraction/);
  });
});
