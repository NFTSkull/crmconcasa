import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const previewPath = join(
  process.cwd(),
  "src/components/mesa-control/MesaInfonavitSourceDocumentPreview.tsx",
);
const panelPath = join(
  process.cwd(),
  "src/components/mesa-control/MesaClabeShadowDetectionPanel.tsx",
);
const formPath = join(
  process.cwd(),
  "src/components/mesa-control/MesaInfonavitGenerarDocumentosForm.tsx",
);
const parserPath = join(
  process.cwd(),
  "src/domain/document-extractions/clabe-bank-statement.ts",
);

const previewSrc = readFileSync(previewPath, "utf8");
const panelSrc = readFileSync(panelPath, "utf8");
const formSrc = readFileSync(formPath, "utf8");
const parserSrc = readFileSync(parserPath, "utf8");

describe("P4B Mesa CLABE shadow UI contrato", () => {
  it("16. context clabe dispara análisis con fallback OCR", () => {
    assert.match(previewSrc, /shouldRunClabeShadowDetection\(context\)/);
    assert.match(previewSrc, /detectClabeFromBankStatementPdfBytes/);
    assert.match(previewSrc, /extractDocumentTextViaOcr/);
    assert.match(previewSrc, /detectClabeFromBankStatementText\(extracted\.text\)/);
    assert.match(
      previewSrc,
      /document-ocr:\$\{expectedDocId\}:cliente_estado_cuenta:critical-v3/,
    );
    assert.match(previewSrc, /MesaClabeShadowDetectionPanel/);
    assert.match(previewSrc, /Buscando CLABE|clabeAnalyzing/);
  });

  it("17–19. rfc / identidad / vivienda NO analizan CLABE", () => {
    // solo shouldRunClabeShadowDetection(context) — false fuera de clabe
    assert.match(
      previewSrc,
      /if \(!shouldRunClabeShadowDetection\(context\)\)/,
    );
    assert.doesNotMatch(
      previewSrc,
      /context === "rfc"[\s\S]{0,80}detectClabeFromBankStatementPdfBytes/,
    );
  });

  it("20. detected se muestra pero NO modifica input / draft", () => {
    assert.match(panelSrc, /CLABE detectada/);
    assert.match(panelSrc, /no se escribe en el formulario/i);
    assert.doesNotMatch(panelSrc, /updateDestinoClabeDerechohabiente/);
    assert.doesNotMatch(panelSrc, /mesa_generar_infonavit_documentos/);
    assert.doesNotMatch(
      previewSrc,
      /updateDestinoClabeDerechohabiente|mesa_generar_infonavit_documentos/,
    );
    // form sigue siendo dueño del input
    assert.match(formSrc, /updateDestinoClabeDerechohabiente/);
    assert.doesNotMatch(formSrc, /detectClabeFromBankStatement/);
  });

  it("CLABE ya aplicada por OCR manda sobre shadow y evita análisis duplicado", () => {
    assert.match(previewSrc, /clabeAppliedValue/);
    assert.match(previewSrc, /alreadyApplied/);
    assert.match(previewSrc, /isValidClabeMexico\(alreadyApplied\)/);
    assert.match(previewSrc, /appliedClabeDetection/);
    assert.match(
      previewSrc,
      /visibleClabeDetection\s*=\s*appliedClabeDetection\s*\?\?\s*shadowClabeDetection/,
    );
    assert.match(panelSrc, /Aplicada automáticamente al formulario/);
    assert.match(previewSrc, /applied=\{Boolean\(appliedClabeDetection\)\}/);
  });

  it("21. ambiguous no elige candidato", () => {
    assert.match(panelSrc, /varias CLABE posibles/);
    assert.match(panelSrc, /result\.candidates\.map/);
    assert.doesNotMatch(panelSrc, /aplicar|usar esta|autocompletar/i);
  });

  it("22. no_text_layer permite manual", () => {
    assert.match(panelSrc, /Verifica la\s+CLABE manualmente/);
    assert.match(panelSrc, /status === "no_text_layer"/);
  });

  it("23. cambio de documento/expediente descarta resultado anterior", () => {
    assert.match(previewSrc, /clabeCacheRef\.current\.clear\(\)/);
    assert.match(previewSrc, /clabeGenRef\.current \+= 1/);
    assert.match(previewSrc, /gen !== clabeGenRef\.current/);
    assert.match(previewSrc, /ActiveDocumentBlob|activeDocumentBlob/);
    assert.match(previewSrc, /documentoId:\s*docId/);
    assert.match(previewSrc, /canRunClabeDetection/);
    assert.match(previewSrc, /resolveVisibleClabeDetection/);
    assert.match(previewSrc, /visibleClabeDetection/);
    assert.match(previewSrc, /blob_mismatch|no_blob/);
  });

  it("24. unmount/race no actualiza estado viejo", () => {
    assert.match(previewSrc, /cancelled \|\| gen !== clabeGenRef/);
    assert.match(previewSrc, /cancelled = true/);
  });

  it("25. no logs con texto extraído", () => {
    assert.doesNotMatch(previewSrc, /console\.(log|debug|info).*text/i);
    assert.doesNotMatch(parserSrc, /console\.(log|debug|info)/);
    assert.match(parserSrc, /NO se retorna ni se debe loguear|sin persistencia/i);
    assert.doesNotMatch(parserSrc, /localStorage|sessionStorage|action_log/);
  });

  it("26–28. P4A preview / Frente-Reverso / revoke intactos", () => {
    assert.match(previewSrc, /URL\.createObjectURL/);
    assert.match(previewSrc, /URL\.revokeObjectURL/);
    assert.match(previewSrc, /MesaArchivoPreviewDialog/);
    assert.match(previewSrc, /selectIneSide\("frente"\)/);
    assert.match(previewSrc, /selectIneSide\("reverso"\)/);
    assert.match(previewSrc, /getArchivoBlob/);
    assert.doesNotMatch(previewSrc, /getPublicUrl|createSignedUrl/);
  });

  it("cero OCR / provider / enqueue / migration hooks", () => {
    assert.doesNotMatch(
      previewSrc,
      /OpenAI|Document AI|Azure|enqueue_document_extraction/i,
    );
    assert.doesNotMatch(
      parserSrc,
      /OpenAI|Document AI|Azure|enqueue_document_extraction/i,
    );
    assert.match(parserSrc, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
    assert.match(parserSrc, /Math\.min\(doc\.numPages, 3\)/);
    assert.match(parserSrc, /Math\.abs\(candidate\.y - y\) <= 2\.5/);
  });
});
