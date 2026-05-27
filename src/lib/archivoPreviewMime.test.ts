import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  archivoPreviewEsSoloLectura,
  isArchivoPreviewImageMime,
  isArchivoPreviewPdfMime,
} from "./archivoPreviewMime";

describe("B0D6.3: archivoPreviewMime", () => {
  it("detecta imágenes previsualizables", () => {
    assert.equal(isArchivoPreviewImageMime("image/png"), true);
    assert.equal(isArchivoPreviewImageMime("image/jpeg"), true);
    assert.equal(isArchivoPreviewImageMime("image/jpg"), true);
    assert.equal(isArchivoPreviewImageMime("image/webp"), true);
    assert.equal(isArchivoPreviewImageMime("application/pdf"), false);
  });

  it("detecta PDF", () => {
    assert.equal(isArchivoPreviewPdfMime("application/pdf"), true);
    assert.equal(isArchivoPreviewPdfMime("APPLICATION/PDF"), true);
    assert.equal(isArchivoPreviewPdfMime("image/png"), false);
  });

  it("vista previa es solo lectura (no cambia estatus)", () => {
    assert.equal(archivoPreviewEsSoloLectura(), true);
  });
});
