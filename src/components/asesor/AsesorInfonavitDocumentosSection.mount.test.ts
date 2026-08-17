import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function extractJsxBlock(src: string, componentName: string): string {
  const re = new RegExp(
    `<${componentName}\\b[\\s\\S]*?<\\/${componentName}>|<${componentName}\\b[\\s\\S]*?/>`,
  );
  const m = src.match(re);
  assert.ok(m, `No se encontró JSX de <${componentName}>`);
  return m[0];
}

describe("AsesorInfonavitDocumentosSection montaje", () => {
  const pagePath = join(
    process.cwd(),
    "src/app/asesor/expediente/[id]/page.tsx",
  );
  const componentPath = join(
    process.cwd(),
    "src/components/asesor/AsesorInfonavitDocumentosSection.tsx",
  );
  const sharedPath = join(
    process.cwd(),
    "src/components/mesa-control/infonavit-pdf-documentos-shared.tsx",
  );
  const pageSrc = readFileSync(pagePath, "utf8");
  const componentSrc = readFileSync(componentPath, "utf8");
  const sharedSrc = readFileSync(sharedPath, "utf8");

  it("owner post-Mesa: sección RO solo Mejoravit enviado", () => {
    assert.match(pageSrc, /import\s+\{\s*AsesorInfonavitDocumentosSection\s*\}/);
    assert.match(pageSrc, /esMejoravit && dataSupabase && precal\?\.id/);
    const jsx = extractJsxBlock(pageSrc, "AsesorInfonavitDocumentosSection");
    assert.match(jsx, /submittedToMesa=\{operativo\?\.submittedToMesa/);
    assert.match(componentSrc, /submittedToMesa/);
    assert.match(componentSrc, /Solo lectura/);
  });

  it("pre-Mesa no muestra PDFs ni botones de generar/subir", () => {
    assert.match(componentSrc, /submittedToMesa/);
    assert.doesNotMatch(componentSrc, /Generar PDF|Previsualizar plantilla|Subir solicitud/);
    assert.doesNotMatch(sharedSrc, /Validar|Rechazar|Reemplazar|Eliminar|Subir archivo/);
    assert.doesNotMatch(pageSrc, /Generar PDF/);
  });

  it("no hay acciones de upload/replace/delete/validate en la sección", () => {
    assert.doesNotMatch(componentSrc, /onValidar|uploadArchivo|replaceArchivo/);
    assert.match(sharedSrc, /Ver PDF/);
    assert.match(sharedSrc, /Descargar/);
  });
});
