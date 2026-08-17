import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("AsesorInfonavitDocumentosSection montaje B8", () => {
  const pagePath = join(
    process.cwd(),
    "src/app/asesor/expediente/[id]/page.tsx",
  );

  const pageSrc = readFileSync(pagePath, "utf8");

  it("asesor NO monta Documentos INFONAVIT (Mesa-only)", () => {
    assert.doesNotMatch(pageSrc, /import\s+\{\s*AsesorInfonavitDocumentosSection\s*\}/);
    assert.doesNotMatch(pageSrc, /<AsesorInfonavitDocumentosSection/);
    assert.doesNotMatch(pageSrc, /fetchP189InfonavitFeatureStatus/);
    assert.doesNotMatch(pageSrc, /showInfonavitDatosFields/);
  });
});
