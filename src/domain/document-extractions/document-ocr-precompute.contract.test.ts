import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const form = readFileSync(
  join(root, "src/components/mesa-control/MesaInfonavitGenerarDocumentosForm.tsx"),
  "utf8",
);
const upload = readFileSync(
  join(root, "src/components/asesor/AsesorIntegracionDocsUpload.impl.tsx"),
  "utf8",
);
const generales = readFileSync(
  join(root, "src/components/mesa-control/MesaClienteDatosReadOnlySection.tsx"),
  "utf8",
);
const validityGuard = readFileSync(
  join(root, "src/components/mesa-control/MesaIneValidityGuard.tsx"),
  "utf8",
);
const previewDialog = readFileSync(
  join(root, "src/components/mesa-control/MesaArchivoPreviewDialog.tsx"),
  "utf8",
);
const ocrService = readFileSync(
  join(root, "services/document-ocr/app.py"),
  "utf8",
);
const edge = readFileSync(
  join(root, "supabase/functions/document-ocr-precompute/index.ts"),
  "utf8",
);
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260918225154_document_ocr_cache_precompute.sql",
  ),
  "utf8",
);

describe("INFONAVIT OCR precalentado", () => {
  it("Mesa consulta cache antes de descargar o invocar OCR", () => {
    const cacheIdx = form.indexOf("getMesaInfonavitOcrCache(expedienteId)");
    const blobIdx = form.indexOf("archivosRepo.getArchivoBlob(job.doc.id)");
    assert.ok(cacheIdx > 0);
    assert.ok(blobIdx > cacheIdx);
    assert.match(form, /cached\?\.status === "done"/);
    assert.match(form, /cached\.documentoId === job\.doc\.id/);
  });

  it("Volver a leer fuerza fallback y no reutiliza cache", () => {
    assert.match(
      form,
      /autofillRetryNonce === 0[\s\S]*?getMesaInfonavitOcrCache/,
    );
  });

  it("subida dispara precalentado y falla abierto", () => {
    const uploadIdx = upload.indexOf("requestDocumentOcrPrecompute");
    const uploadedIdx = upload.indexOf("onUploaded();");
    assert.ok(uploadIdx > 0);
    assert.ok(uploadedIdx > uploadIdx);
    assert.match(upload, /Fail-open: la subida ya quedó registrada/);
  });

  it("Edge Function responde 202 y continúa con waitUntil", () => {
    assert.match(edge, /EdgeRuntime\.waitUntil/);
    assert.match(edge, /processDocument\(/);
    assert.match(edge, /202/);
    assert.match(edge, /expediente-documentos/);
    assert.match(edge, /\/v1\/extract/);
  });

  it("cache de PII no es accesible directamente por authenticated", () => {
    assert.match(migration, /ALTER TABLE public\.document_ocr_cache FORCE ROW LEVEL SECURITY/);
    assert.match(
      migration,
      /REVOKE ALL ON TABLE public\.document_ocr_cache[\s\S]*?authenticated/,
    );
    assert.match(migration, /can_see_expediente\(p_expediente_id\)/);
    assert.match(migration, /mesa_get_infonavit_ocr_cache/);
  });

  it("una versión nueva no reutiliza OCR de otro documento", () => {
    assert.match(migration, /documento_id UUID PRIMARY KEY/);
    assert.match(form, /cached\.documentoId === job\.doc\.id/);
  });

  it("Generales monta el guard de vigencia sin depender de la pestaña INFONAVIT", () => {
    const guardIdx = generales.indexOf(
      "<MesaIneValidityGuard expedienteId={props.expedienteId} />",
    );
    const tabIdx = generales.indexOf('tab === "asesor"');
    assert.ok(guardIdx > 0);
    assert.ok(tabIdx > guardIdx);
  });

  it("guard rechaza solo vigencia explícita vencida y usa la RPC canónica del repo", () => {
    assert.match(validityGuard, /evaluateIneValidity/);
    assert.match(validityGuard, /assessment\.canAutoReject/);
    assert.match(validityGuard, /REJECTABLE_STATUSES/);
    assert.match(validityGuard, /archivosRepo\.updateRevision/);
    assert.match(validityGuard, /estatus_revision: "rechazado"/);
    assert.match(validityGuard, /EXPEDIENTE_ARCHIVOS_UPDATED_EVENT/);
    assert.match(validityGuard, /EXPEDIENTE_CORRECCION_REFRESH_EVENT/);
    assert.match(validityGuard, /INE vencida/);
  });

  it("visor grande permite zoom y rotación sin alterar el archivo", () => {
    assert.match(previewDialog, /setZoom\(2\)/);
    assert.match(previewDialog, /changeZoom\(-0\.25\)/);
    assert.match(previewDialog, /setRotation\(\(value\) => value - 90\)/);
    assert.match(previewDialog, /setRotation\(\(value\) => value \+ 90\)/);
    assert.match(previewDialog, /transform:[\s\S]*rotate/);
  });

  it("OCR de INE prueba orientación y deskew antes de la lectura final", () => {
    assert.match(ocrService, /def orient_ine_image/);
    assert.match(ocrService, /for degrees in \(90, 180, 270\)/);
    assert.match(ocrService, /def deskew_small_angle/);
    assert.match(ocrService, /source = orient_ine_image/);
    assert.match(ocrService, /source = deskew_small_angle/);
  });

});
