import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("fiscal-rfc-precompute", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

  it("resuelve exclusivamente desde Estado de Cuenta y OCR cacheado", () => {
    assert.match(src, /resolveEstadoCuentaFiscalRfc/);
    assert.match(src, /cliente_estado_cuenta/);
    assert.match(src, /document_ocr_cache/);
    assert.match(src, /ocr_cache/);
    assert.match(src, /source: "estado_cuenta"/);
  });

  it("persiste candidato ligado al documento actual sin modificar Bansefi/DG", () => {
    assert.match(src, /fiscal_rfc_status/);
    assert.match(src, /fiscal_rfc_read_source/);
    assert.match(src, /documentoId/);
    assert.doesNotMatch(src, /update\(\{[^}]*rfc_infonavit/s);
    assert.doesNotMatch(src, /jsonb_set\([^)]*rfc/s);
  });

  it("nunca expone RFC completo en la respuesta", () => {
    assert.match(src, /rfcMasked: maskFiscalId/);
    assert.doesNotMatch(src, /rfc:\s*resolution\.fiscalRfc/);
  });
});
