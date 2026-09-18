import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const generales = readFileSync(
  join(root, "src/components/mesa-control/MesaClienteDatosReadOnlySection.tsx"),
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
  it("corre al abrir Generales, antes de elegir pestaña", () => {
    const guardIdx = generales.indexOf(
      "<MesaIneValidityGuard expedienteId={props.expedienteId} />",
    );
    const tabIdx = generales.indexOf('tab === "asesor"');
    assert.ok(guardIdx > 0);
    assert.ok(tabIdx > guardIdx);
  });

  it("auto-rechaza vigencia vencida solo cuando assessment la considera confiable", () => {
    assert.match(guard, /assessment\.canAutoReject/);
    assert.match(guard, /REJECTABLE_STATUSES/);
    assert.match(guard, /"subido", "resubido"/);
    assert.match(guard, /archivosRepo\.updateRevision/);
    assert.match(guard, /estatus_revision: "rechazado"/);
    assert.match(guard, /hasProtectedStatus/);
  });

  it("si OCR/MRZ es dudoso pide revisión manual en vez de rechazar", () => {
    assert.match(guard, /status === "unknown"/);
    assert.match(guard, /Revísala antes de validar/);
    assert.match(guard, /MRZ\/T7/);
  });

  it("bloquea generación cuando la vigencia confiable está vencida", () => {
    assert.match(form, /ineValidity\?\.canAutoReject/);
    assert.match(form, /No se puede generar con una INE vencida/);
  });
});
