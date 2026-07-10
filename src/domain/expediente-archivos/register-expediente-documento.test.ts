import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExpedienteDocumentoStoragePath,
  inferStorageFileExtension,
  sanitizeExpedienteDocumentoFileName,
  storageObjectKeyLooksSafe,
} from "./storage-path";
import {
  EXPEDIENTE_DOCUMENTO_MAX_BYTES,
  validateExpedienteDocumentoFile,
} from "./upload-constraints";
import { mapRegisterExpedienteDocumentoRpcError } from "./register-expediente-documento-rpc-error";
import { ExpedienteArchivosSupabaseError } from "./supabase.error";

describe("sanitizeExpedienteDocumentoFileName", () => {
  it("elimina barras y caracteres peligrosos", () => {
    assert.equal(sanitizeExpedienteDocumentoFileName("  ../ine/foto.jpg  "), "_ine_foto.jpg");
  });

  it("fallback si queda vacío", () => {
    assert.equal(sanitizeExpedienteDocumentoFileName("@@@"), "archivo");
  });
});

describe("inferStorageFileExtension", () => {
  it("mapea MIME conocidos", () => {
    assert.equal(inferStorageFileExtension("image/jpeg"), "jpg");
    assert.equal(inferStorageFileExtension("image/png"), "png");
    assert.equal(inferStorageFileExtension("application/pdf"), "pdf");
    assert.equal(inferStorageFileExtension("image/heic"), "heic");
  });

  it("usa extensión del nombre si falta MIME", () => {
    assert.equal(
      inferStorageFileExtension(null, "JOHNNY - INE (FRENTE A).jpg"),
      "jpg",
    );
  });
});

const ORG = "00000000-0000-4000-8000-000000000001";
const EXP = "00000000-0000-4000-9001-000000000001";

function buildPath(
  tipo: string,
  mimeType: string,
  originalFileName: string,
): string {
  return buildExpedienteDocumentoStoragePath({
    organizationId: ORG,
    expedienteId: EXP,
    tipoDocumento: tipo,
    mimeType,
    originalFileName,
  });
}

describe("buildExpedienteDocumentoStoragePath", () => {
  it("INE frente JPG con nombre largo y paréntesis genera key segura", () => {
    const original =
      "JOHNNY JAVIER VICENCIO ZUNIGA - INE (FRENTE A).jpg";
    const path = buildPath("cliente_ine_frente", "image/jpeg", original);
    assert.match(path, new RegExp(`^${ORG}/${EXP}/cliente_ine_frente/.+\\.jpg$`));
    assert.doesNotMatch(path, /[ ()áéíóúÁÉÍÓÚñÑ]/);
    assert.doesNotMatch(path, new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(storageObjectKeyLooksSafe(path), true);
  });

  it("INE reverso JPG con espacios y paréntesis", () => {
    const path = buildPath(
      "cliente_ine_reverso",
      "image/jpeg",
      "INE (REVERSO) escaneo 2024.jpg",
    );
    assert.match(path, /\.jpg$/);
    assert.doesNotMatch(path, /[ ()]/);
    assert.equal(storageObjectKeyLooksSafe(path), true);
  });

  it("PDF con nombre largo y espacios", () => {
    const path = buildPath(
      "cliente_estado_cuenta",
      "application/pdf",
      "Estado de Cuenta Banco - Marzo 2026 (final).pdf",
    );
    assert.match(path, /\.pdf$/);
    assert.doesNotMatch(path, /[ ()]/);
  });

  it("PDF con acentos en nombre original no afecta la key", () => {
    const original = "José Pérez - comprobante (final).pdf";
    const path = buildPath("cliente_comprobante_domicilio", "application/pdf", original);
    const fileSegment = path.split("/").pop() ?? "";
    assert.match(path, /\.pdf$/);
    assert.doesNotMatch(fileSegment, /[ ()áéíóúñ]/i);
    assert.doesNotMatch(fileSegment, /José|Pérez|final/i);
  });

  it("genera prefijo org/exp/tipo sin nombre original en path", () => {
    const path = buildPath("ine", "application/pdf", "mi ine.pdf");
    assert.match(path, new RegExp(`^${ORG}/${EXP}/ine/[0-9a-f-]{36}\\.pdf$`, "i"));
  });
});

describe("validateExpedienteDocumentoFile", () => {
  it("rechaza mime no permitido", () => {
    const file = { type: "text/plain", size: 100, name: "x.txt" } as File;
    const result = validateExpedienteDocumentoFile(file);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "mime_no_permitido");
  });

  it("acepta PDF con text/plain y extensión .pdf", () => {
    const file = { type: "text/plain", size: 100, name: "x.pdf" } as File;
    assert.deepEqual(validateExpedienteDocumentoFile(file, "cliente_estado_cuenta"), { ok: true });
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

  it("acepta image/jpeg en acta nacimiento digital", () => {
    const file = {
      type: "image/jpeg",
      size: 800_000,
      name: "acta.jpg",
    } as File;
    assert.deepEqual(
      validateExpedienteDocumentoFile(file, "cliente_acta_nacimiento_digital"),
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
