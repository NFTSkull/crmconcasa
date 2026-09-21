import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const detalle = readFileSync(
  join(root, "src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx"),
  "utf8",
);
const guard = readFileSync(
  join(root, "src/components/mesa-control/MesaIneValidityGuard.tsx"),
  "utf8",
);
const form = readFileSync(
  join(root, "src/components/mesa-control/MesaInfonavitGenerarDocumentosForm.tsx"),
  "utf8",
);

describe("Mesa INE validity guard contract", () => {
  it("corre al abrir el expediente, fuera del acordeón de Generales", () => {
    const guardIdx = detalle.indexOf(
      "<MesaIneValidityGuard expedienteId={routeExpedienteId} />",
    );
    const generalesIdx = detalle.indexOf('id="mesa-datos-generales"');
    assert.ok(guardIdx > 0);
    assert.ok(generalesIdx > guardIdx);
  });

  it("auto-rechaza vigencia vencida solo cuando assessment la considera confiable", () => {
    assert.match(guard, /assessment\.canAutoReject/);
    assert.match(guard, /REJECTABLE_STATUSES/);
    assert.match(guard, /"subido", "resubido"/);
    assert.match(guard, /archivosRepo\.updateRevision/);
    assert.match(guard, /estatus_revision: "rechazado"/);
    assert.match(guard, /hasProtectedStatus/);
  });

  it("si cache OCR no trae vigencia, refresca sin duplicar la lectura central", () => {
    assert.match(guard, /frontRead\.fromCache/);
    assert.match(guard, /readFreshText/);
    assert.match(
      guard,
      /document-ocr:\$\{doc\.id\}:\$\{type\}:critical-v3/,
    );
    assert.doesNotMatch(guard, /ine-validity-fresh-v2/);
  });

  it("si OCR/MRZ es dudoso pide revisión manual en vez de rechazar", () => {
    assert.match(guard, /status === "unknown"/);
    assert.match(guard, /Revísala antes de validar/);
    assert.match(guard, /MRZ\/T7/);
  });

  it("muestra la vigencia como 31/12/año y permite captura manual", () => {
    assert.match(form, /label="Vigencia identificación"/);
    assert.match(form, /placeholder="31\/12\/aaaa"/);
    assert.match(form, /maxLength=\{10\}/);
    assert.match(form, /normalizeMesaIneValidityForDocuments\(v\)/);
    assert.match(guard, /assessment\.expirationYear/);
  });

  it("bloquea generación cuando la vigencia confiable está vencida", () => {
    assert.match(form, /ineValidity\?\.canAutoReject/);
    assert.match(form, /No se puede generar con una INE vencida/);
  });
});
