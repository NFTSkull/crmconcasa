import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Hotfix Constancia CURP — montaje estático asesor + Mesa.
 */
describe("Hotfix Constancia CURP montaje", () => {
  const asesor = readFileSync(
    join(process.cwd(), "src/components/asesor/AsesorCurpValidacionSection.tsx"),
    "utf8",
  );
  const mesa = readFileSync(
    join(
      process.cwd(),
      "src/components/mesa-control/MesaCurpValidacionReadOnlySection.tsx",
    ),
    "utf8",
  );
  const form = readFileSync(
    join(
      process.cwd(),
      "src/components/asesor/ExpedienteClienteDatosFormSection.tsx",
    ),
    "utf8",
  );

  it("asesor usa DocumentDropzone (arrastrar / clic)", () => {
    assert.match(asesor, /DocumentDropzone/);
    assert.match(asesor, /CONSTANCIA_CURP_DROPZONE_HINT|Arrastra aquí la constancia/);
    assert.match(asesor, /onFiles=\{/);
    assert.doesNotMatch(
      asesor,
      /<input[\s\S]*type="file"[\s\S]*Subir constancia/,
    );
  });

  it("éxito muestra nombre y Ver/Descargar/Reemplazar", () => {
    assert.match(asesor, /Constancia CURP subida correctamente/);
    assert.match(asesor, />\s*Ver\s*</);
    assert.match(asesor, />\s*Descargar\s*</);
    assert.match(asesor, />\s*Reemplazar\s*</);
    assert.match(asesor, /labelConstanciaEnvioMesa\(submittedToMesa\)/);
  });

  it("pasa submittedToMesa desde el formulario de Datos Generales", () => {
    assert.match(form, /submittedToMesa=\{submittedToMesa\}/);
  });

  it("upload ocurre antes del parse; error de análisis no oculta guardado", () => {
    const uploadCall = asesor.indexOf("archivosRepo.replaceArchivo");
    const parseCall = asesor.indexOf("await extractPdfEmbeddedText");
    assert.ok(uploadCall > 0 && parseCall > uploadCall);
    assert.match(asesor, /Constancia CURP subida correctamente/);
    assert.match(asesor, /labelConstanciaStatus\("ERROR_ANALISIS"\)/);
    assert.match(asesor, /if \(uploadedOk\)/);
  });

  it("busyRef evita doble upload", () => {
    assert.match(asesor, /busyRef\.current/);
    assert.match(asesor, /if \(busyRef\.current \|\| !canEdit\) return/);
  });

  it("Mesa muestra Constancia CURP recibida con Ver/Descargar", () => {
    assert.match(mesa, /Constancia CURP/);
    assert.match(mesa, /✓ Recibida/);
    assert.match(mesa, />\s*Ver\s*</);
    assert.match(mesa, />\s*Descargar\s*</);
    assert.doesNotMatch(mesa, /Acta digital/);
    // Enums solo como argumento a labels, no como texto visible crudo.
    assert.match(mesa, /labelEstadoValidacionMesa/);
    assert.match(mesa, /RFC_VALIDACION_SAT_PENDIENTE/);
    assert.doesNotMatch(mesa, />\s*ERROR_ANALISIS\s*</);
    assert.doesNotMatch(mesa, />\s*RFC_VALIDACION_SAT_PENDIENTE\s*</);
  });

  it("microcopy amigable vía labels (sin enums crudos en UI)", () => {
    assert.match(mesa, /labelEstadoValidacionMesa/);
    assert.match(asesor, /labelConstanciaStatus/);
    assert.doesNotMatch(asesor, /Sin validar \/ piloto/);
  });
});
