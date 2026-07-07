import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExpedienteDocumentoStoragePath,
  sanitizeExpedienteDocumentoFileName,
} from "./storage-path";
import {
  EXPEDIENTE_DOCUMENTO_MAX_BYTES,
  validateExpedienteDocumentoFile,
} from "./upload-constraints";
import { mapRegisterExpedienteDocumentoRpcError } from "./register-expediente-documento-rpc-error";
import { ExpedienteArchivosSupabaseError } from "./supabase.error";

describe("sanitizeExpedienteDocumentoFileName", () => {
  it("elimina barras y caracteres peligrosos", () => {
    assert.equal(sanitizeExpedienteDocumentoFileName("  ../ine/foto.jpg  "), "ine_foto.jpg");
  });

  it("fallback si queda vacío", () => {
    assert.equal(sanitizeExpedienteDocumentoFileName("@@@"), "archivo");
  });
});

describe("buildExpedienteDocumentoStoragePath", () => {
  it("genera prefijo org/exp/tipo", () => {
    const path = buildExpedienteDocumentoStoragePath({
      organizationId: "00000000-0000-4000-8000-000000000001",
      expedienteId: "00000000-0000-4000-9001-000000000001",
      tipoDocumento: "ine",
      originalFileName: "mi ine.pdf",
    });
    assert.match(
      path,
      /^00000000-0000-4000-8000-000000000001\/00000000-0000-4000-9001-000000000001\/ine\/.+-mi ine\.pdf$/,
    );
  });
});

describe("validateExpedienteDocumentoFile", () => {
  it("rechaza mime no permitido", () => {
    const file = { type: "text/plain", size: 100, name: "x.pdf" } as File;
    const result = validateExpedienteDocumentoFile(file);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "mime_no_permitido");
  });

  it("rechaza JPG en comprobante de domicilio", () => {
    const file = { type: "image/jpeg", size: 100, name: "foto.jpg" } as File;
    const result = validateExpedienteDocumentoFile(file, "cliente_comprobante_domicilio");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "mime_no_permitido");
  });

  it("acepta JPG en INE frente", () => {
    const file = { type: "image/jpeg", size: 100, name: "foto.jpg" } as File;
    assert.deepEqual(
      validateExpedienteDocumentoFile(file, "cliente_ine_frente"),
      { ok: true },
    );
  });

  it("acepta PDF en INE reverso", () => {
    const file = { type: "application/pdf", size: 100, name: "ine.pdf" } as File;
    assert.deepEqual(
      validateExpedienteDocumentoFile(file, "cliente_ine_reverso"),
      { ok: true },
    );
  });

  it("rechaza tamaño excedido", () => {
    const file = {
      type: "application/pdf",
      size: EXPEDIENTE_DOCUMENTO_MAX_BYTES + 1,
      name: "grande.pdf",
    } as File;
    const result = validateExpedienteDocumentoFile(file);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "tamano_excedido");
  });

  it("acepta PDF válido", () => {
    const file = { type: "application/pdf", size: 1024, name: "doc.pdf" } as File;
    assert.deepEqual(validateExpedienteDocumentoFile(file), { ok: true });
  });

  it("acepta PDF válido con octet-stream y extensión .pdf (carta empresa)", () => {
    const file = {
      type: "application/octet-stream",
      size: 1_500_000,
      name: "carta.pdf",
    } as File;
    assert.deepEqual(
      validateExpedienteDocumentoFile(file, "cliente_carta_empresa"),
      { ok: true },
    );
  });

  it("acepta image/jpeg en carta empresa", () => {
    const file = {
      type: "image/jpeg",
      size: 800_000,
      name: "carta.jpg",
    } as File;
    assert.deepEqual(
      validateExpedienteDocumentoFile(file, "cliente_carta_empresa"),
      { ok: true },
    );
  });

  it("rechaza image/jpeg en comprobante domicilio", () => {
    const file = {
      type: "image/jpeg",
      size: 800_000,
      name: "foto.jpg",
    } as File;
    const result = validateExpedienteDocumentoFile(file, "cliente_comprobante_domicilio");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "mime_no_permitido");
  });
});

describe("mapRegisterExpedienteDocumentoRpcError", () => {
  it("mapea ya enviado a mesa", () => {
    const err = mapRegisterExpedienteDocumentoRpcError({
      message: "register_expediente_documento: el expediente ya fue enviado a Mesa",
    });
    assert.ok(err instanceof ExpedienteArchivosSupabaseError);
    assert.match(err.message, /ya fue enviado a Mesa/i);
  });

  it("mapea tipo no permitido", () => {
    const err = mapRegisterExpedienteDocumentoRpcError({
      message: "register_expediente_documento: tipo_documento no permitido para asesor (cliente_acta_nacimiento)",
    });
    assert.match(err.message, /no corresponde al checklist/i);
  });

  it("mapea mime no permitido a solo PDF", () => {
    const err = mapRegisterExpedienteDocumentoRpcError({
      message: "register_expediente_documento: mime_type no permitido (image/png)",
    });
    assert.match(err.message, /Solo se permiten archivos PDF/i);
  });
});
