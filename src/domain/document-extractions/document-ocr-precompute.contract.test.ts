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
const edge = readFileSync(
  join(root, "supabase/functions/document-ocr-precompute/index.ts"),
  "utf8",
);
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260918213000_document_ocr_cache_precompute.sql",
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
});
