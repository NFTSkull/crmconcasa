import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ExpedienteClienteDatosFormSection capturaVariant", () => {
  const src = readFileSync(
    join(process.cwd(), "src/components/asesor/ExpedienteClienteDatosFormSection.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "src/app/asesor/expediente/[id]/page.tsx"),
    "utf8",
  );

  it("declara prop capturaVariant y data-captura-variant", () => {
    assert.match(src, /capturaVariant\?: ClienteDatosCapturaVariant/);
    assert.match(src, /data-captura-variant=\{capturaVariant\}/);
    assert.match(src, /esSimplificado = capturaVariant === "simplificado"/);
  });

  it("simplificado omite CURP piloto, RFC, refs/beneficiario y plazo", () => {
    assert.match(src, /\{!esSimplificado && expedienteId \? \([\s\S]*AsesorCurpValidacionSection/);
    assert.match(src, /\{!esSimplificado \? \([\s\S]*Referencias/);
    assert.match(src, /Celular del cliente \(obligatorio\)/);
  });

  it("página: vista por actor, checklist por dueño UUID", () => {
    assert.match(page, /actorEnEquipoSilvia/);
    assert.match(page, /duenoEnEquipoSilvia/);
    assert.match(page, /asesorProfileId/);
    assert.match(page, /perfilCaptura: perfilCapturaClienteDatos/);
    assert.match(page, /capturaVariant=\{capturaVariantClienteDatos\}/);
    assert.match(page, /resolveClienteDatosPerfilCaptura/);
    assert.match(page, /fetchAsesorEnEquipoPorLiderEmail/);
  });
});
