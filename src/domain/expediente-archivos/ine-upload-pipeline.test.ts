/**
 * Contrato crítico: pipeline INE JPG → Storage/RPC solo PDF
 * (espejo de uploadOrReplace / correctArchivoRechazado).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  buildInePdfFileName,
  embedJpegInPdfFile,
  prepareIneFileForUpload,
} from "@/lib/ineImageToPdf";
import { resolveExpedienteDocumentoUploadMime } from "@/lib/fileUploadValidation";
import { buildExpedienteDocumentoStoragePath } from "@/domain/expediente-archivos/storage-path";
import { validateExpedienteDocumentoFile } from "@/domain/expediente-archivos/upload-constraints";

const MIN_JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xff, 0xc4, 0x00, 0x14,
  0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9,
]);

/** Simula la preparación que hace el repo antes de Storage/RPC. */
async function simulateIneUploadPipeline(input: {
  file: File;
  tipo: "cliente_ine_frente" | "cliente_ine_reverso";
  /** En tests Node: PDF ya convertido (equivalente a prepare exitoso). */
  preparedOverride?: File;
}) {
  const originalValidation = validateExpedienteDocumentoFile(input.file, input.tipo);
  assert.equal(originalValidation.ok, true);

  const prepared =
    input.preparedOverride ??
    (await prepareIneFileForUpload(input.file, input.tipo)).file;

  const post = validateExpedienteDocumentoFile(prepared, input.tipo);
  assert.equal(post.ok, true);

  const uploadMime = resolveExpedienteDocumentoUploadMime(prepared, input.tipo);
  assert.equal(uploadMime, "application/pdf");

  const storagePath = buildExpedienteDocumentoStoragePath({
    organizationId: "00000000-0000-4000-8000-000000000001",
    expedienteId: "00000000-0000-4000-8000-000000000099",
    tipoDocumento: input.tipo,
    mimeType: uploadMime,
    originalFileName: prepared.name,
  });

  const rpc = {
    p_expediente_id: "00000000-0000-4000-8000-000000000099",
    p_tipo_documento: input.tipo,
    p_storage_path: storagePath,
    p_nombre_original: prepared.name,
    p_mime_type: uploadMime,
    p_size_bytes: prepared.size,
  };

  return {
    storageBody: prepared,
    storageContentType: uploadMime,
    storagePath,
    rpc,
  };
}

describe("INE upload pipeline → solo PDF a Storage/RPC", () => {
  it("JPG frente: body PDF, contentType pdf, path .pdf, RPC pdf, sin JPG", async () => {
    const jpg = new File([MIN_JPEG], "ine-frente.jpg", { type: "image/jpeg" });
    const pdf = await embedJpegInPdfFile(MIN_JPEG, 1, 1, buildInePdfFileName(jpg.name));

    const out = await simulateIneUploadPipeline({
      file: jpg,
      tipo: "cliente_ine_frente",
      preparedOverride: pdf,
    });

    assert.equal(out.storageBody.type, "application/pdf");
    assert.ok(out.storageBody.name.endsWith(".pdf"));
    assert.ok(!out.storageBody.name.toLowerCase().endsWith(".jpg"));
    assert.equal(out.storageContentType, "application/pdf");
    assert.ok(out.storagePath.endsWith(".pdf"));
    assert.ok(out.storagePath.includes("/cliente_ine_frente/"));
    assert.equal(out.rpc.p_tipo_documento, "cliente_ine_frente");
    assert.ok(out.rpc.p_nombre_original.endsWith(".pdf"));
    assert.equal(out.rpc.p_mime_type, "application/pdf");
    assert.equal(out.rpc.p_size_bytes, pdf.size);

    const head = new Uint8Array(await out.storageBody.arrayBuffer()).slice(0, 4);
    assert.equal(String.fromCharCode(...head), "%PDF");
  });

  it("JPG reverso: mismo contrato PDF", async () => {
    const jpg = new File([MIN_JPEG], "ine-reverso.jpeg", { type: "image/jpeg" });
    const pdf = await embedJpegInPdfFile(MIN_JPEG, 2, 1, buildInePdfFileName(jpg.name));
    const out = await simulateIneUploadPipeline({
      file: jpg,
      tipo: "cliente_ine_reverso",
      preparedOverride: pdf,
    });
    assert.equal(out.rpc.p_tipo_documento, "cliente_ine_reverso");
    assert.equal(out.rpc.p_mime_type, "application/pdf");
    assert.ok(out.storagePath.endsWith(".pdf"));
  });

  it("PDF directo: no cambia tipo ni MIME", async () => {
    const pdfBytes = await (
      await embedJpegInPdfFile(MIN_JPEG, 1, 1, "ya.pdf")
    ).arrayBuffer();
    const pdf = new File([pdfBytes], "ya.pdf", { type: "application/pdf" });
    const prepared = await prepareIneFileForUpload(pdf, "cliente_ine_frente");
    assert.equal(prepared.converted, false);
    assert.equal(prepared.file, pdf);

    const out = await simulateIneUploadPipeline({
      file: pdf,
      tipo: "cliente_ine_frente",
    });
    assert.equal(out.rpc.p_mime_type, "application/pdf");
    assert.equal(out.rpc.p_nombre_original, "ya.pdf");
  });

  it("reemplazo: nueva versión activa es PDF (payload v2)", async () => {
    const jpg = new File([MIN_JPEG], "nueva-ine.jpg", { type: "image/jpeg" });
    const v2 = await embedJpegInPdfFile(MIN_JPEG, 3, 2, buildInePdfFileName(jpg.name));
    const out = await simulateIneUploadPipeline({
      file: jpg,
      tipo: "cliente_ine_frente",
      preparedOverride: v2,
    });
    assert.equal(out.rpc.p_mime_type, "application/pdf");
    const doc = await PDFDocument.load(await out.storageBody.arrayBuffer());
    assert.equal(doc.getPageCount(), 1);
  });

  it("supabase.repo integra prepareIneFileForUpload en upload y corrección", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src/domain/expediente-archivos/supabase.repo.ts"),
      "utf8",
    );
    assert.match(src, /prepareIneFileForUpload/);
    assert.match(src, /resolveFileForStorageUpload/);
    assert.match(src, /uploadFile\.name/);
    assert.match(src, /uploadFile\.size/);
    // Ambos caminos usan el helper
    const prepareCalls = src.split("resolveFileForStorageUpload").length - 1;
    assert.ok(prepareCalls >= 3); // def + uploadOrReplace + correctArchivoRechazado
  });
});
