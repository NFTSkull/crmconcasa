import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("AsesorInfonavitDocumentosSection internos", () => {
  const pagePath = join(
    process.cwd(),
    "src/app/asesor/expediente/[id]/page.tsx",
  );
  const solicitudPath = join(
    process.cwd(),
    "src/components/asesor/AsesorSolicitudDocumentoSection.tsx",
  );

  const pageSrc = readFileSync(pagePath, "utf8");
  const solicitudSrc = readFileSync(solicitudPath, "utf8");

  it("mantiene el wiring de Solicitud en expediente y monta INFONAVIT desde esa sección", () => {
    assert.match(pageSrc, /<AsesorSolicitudDocumentoSection/);
    assert.match(
      solicitudSrc,
      /import\s+\{\s*AsesorInfonavitDocumentosSection\s*\}/,
    );
    assert.match(solicitudSrc, /<AsesorInfonavitDocumentosSection/);
  });

  it("usa gate backend fail-closed para internos antes de consultar PDFs", () => {
    assert.match(solicitudSrc, /asesor_puede_ver_infonavit_auto/);
    assert.match(solicitudSrc, /setShowInfonavitAuto\(!rpcError && data === true\)/);
    assert.match(solicitudSrc, /showInfonavitAuto\s*\?\s*\(/);
  });

  it("el componente asesor sigue siendo solo lectura y no pide Word editable", () => {
    const componentPath = join(
      process.cwd(),
      "src/components/asesor/AsesorInfonavitDocumentosSection.tsx",
    );
    const componentSrc = readFileSync(componentPath, "utf8");
    assert.doesNotMatch(componentSrc, /allowWordDownload/);
    assert.doesNotMatch(componentSrc, /Descargar Word editable/);
    assert.doesNotMatch(componentSrc, /infonavit-docx/);
    assert.match(componentSrc, /Solo lectura/);
  });
});
