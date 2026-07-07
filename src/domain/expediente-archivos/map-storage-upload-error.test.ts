import assert from "node:assert/strict";
import test from "node:test";
import { mapSupabaseStorageUploadError } from "./map-storage-upload-error";

test("mapSupabaseStorageUploadError: RLS no se confunde con PDF/15MB", () => {
  const err = mapSupabaseStorageUploadError(
    "new row violates row-level security policy",
    "cliente_ine_frente",
  );
  assert.match(err.message, /permiso/i);
  assert.doesNotMatch(err.message, /15 MB/);
});

test("mapSupabaseStorageUploadError: MIME INE menciona imagen", () => {
  const err = mapSupabaseStorageUploadError(
    "mime type not allowed",
    "cliente_ine_frente",
  );
  assert.match(err.message, /imagen/i);
});

test("mapSupabaseStorageUploadError: MIME comprobante solo PDF", () => {
  const err = mapSupabaseStorageUploadError(
    "invalid file type",
    "cliente_comprobante_domicilio",
  );
  assert.match(err.message, /PDF/i);
  assert.doesNotMatch(err.message, /imagen/i);
});
