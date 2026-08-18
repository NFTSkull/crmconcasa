import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  infonavitPdfUiStatusLabel,
  shouldShowInfonavitPdfSection,
} from "@/domain/expediente-archivos/infonavit-pdf-estado";

function extractJsxBlock(src: string, componentName: string): string {
  const re = new RegExp(
    `<${componentName}\\b[\\s\\S]*?<\\/${componentName}>|<${componentName}\\b[\\s\\S]*?/>`,
  );
  const m = src.match(re);
  assert.ok(m, `No se encontró JSX de <${componentName}>`);
  return m[0];
}

describe("MesaInfonavitDocumentosSection montaje", () => {
  const pagePath = join(
    process.cwd(),
    "src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx",
  );
  const componentPath = join(
    process.cwd(),
    "src/components/mesa-control/MesaInfonavitDocumentosSection.tsx",
  );
  const sharedPath = join(
    process.cwd(),
    "src/components/mesa-control/infonavit-pdf-documentos-shared.tsx",
  );
  const pageSrc = readFileSync(pagePath, "utf8");
  const componentSrc = readFileSync(componentPath, "utf8");
  const sharedSrc = readFileSync(sharedPath, "utf8");

  it("se monta después de documentos del cliente y antes de complementarios", () => {
    assert.match(pageSrc, /import\s+\{\s*MesaInfonavitDocumentosSection\s*\}/);
    const infonavitAt = pageSrc.indexOf("<MesaInfonavitDocumentosSection");
    const docsAt = pageSrc.indexOf('id="mesa-documentos-asesor"');
    const compAt = pageSrc.indexOf('id="mesa-complementarios"');
    assert.ok(infonavitAt > docsAt);
    assert.ok(compAt > infonavitAt);
    const jsx = extractJsxBlock(pageSrc, "MesaInfonavitDocumentosSection");
    assert.match(jsx, /programa=\{expediente\.base\.programa\}/);
  });

  it("Mesa pending/done/failed/previous y sin acciones de revisión", () => {
    assert.match(componentSrc, /Documentos INFONAVIT/);
    assert.match(sharedSrc, /Generando automáticamente/);
    assert.match(sharedSrc, /Versión anterior disponible/);
    assert.match(sharedSrc, /Esto no bloquea el\s+expediente/);
    assert.match(sharedSrc, /Vista previa/);
    assert.match(sharedSrc, /Descargar PDF/);
    assert.match(sharedSrc, /Descargar Word editable/);
    assert.match(sharedSrc, /Generando Word…/);
    assert.match(componentSrc, /allowWordDownload/);
    assert.match(sharedSrc, /\/api\/mesa\/infonavit-docx/);
    assert.doesNotMatch(sharedSrc, /Ver PDF/);
    assert.doesNotMatch(sharedSrc, /Validar/);
    assert.doesNotMatch(sharedSrc, /Rechazar/);
    assert.doesNotMatch(sharedSrc, /Reemplazar/);
    assert.doesNotMatch(sharedSrc, /Eliminar/);
    assert.doesNotMatch(sharedSrc, /Subir/);
    assert.equal(infonavitPdfUiStatusLabel("pending"), "Generando");
    assert.equal(infonavitPdfUiStatusLabel("done"), "Listo");
    assert.equal(infonavitPdfUiStatusLabel("failed"), "Error de generación");
  });

  it("non-Mejoravit no monta sección; polling 10s con cleanup", () => {
    assert.match(componentSrc, /isProgramaMejoravit/);
    assert.match(sharedSrc, /INFONAVIT_PDF_ESTADO_POLL_MS/);
    assert.match(sharedSrc, /startInfonavitPdfEstadoPolling/);
    assert.equal(
      shouldShowInfonavitPdfSection({ aplica: false, has_submission: true }),
      false,
    );
  });

  it("preview/download reutilizan blob privado, no URL pública", () => {
    assert.match(sharedSrc, /getArchivoBlob/);
    assert.match(sharedSrc, /URL\.createObjectURL/);
    assert.doesNotMatch(sharedSrc, /createSignedUrl|getPublicUrl/);
    assert.match(sharedSrc, /MesaArchivoPreviewDialog/);
  });
});
