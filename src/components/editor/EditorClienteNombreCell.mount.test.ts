import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Editor captura de identidad patronal", () => {
  const nameCell = readFileSync(
    join(process.cwd(), "src/components/editor/EditorClienteNombreCell.tsx"),
    "utf8",
  );
  const metadataCell = readFileSync(
    join(process.cwd(), "src/components/editor/EditorPrecalMetadataCell.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "src/app/editor/page.tsx"),
    "utf8",
  );

  it("todas las filas muestran input editable para nombre", () => {
    assert.match(nameCell, /value=\{draft\}/);
    assert.match(nameCell, /placeholder="Nombre completo"/);
    assert.match(nameCell, /editor_update_precal_field/);
    assert.match(nameCell, /p_field:\s*"cliente_nombre"/);
    assert.match(nameCell, /normalizePersonName\(draft\)/);
    assert.match(nameCell, /filterPersonNameInput\(e\.target\.value\)/);
    assert.match(nameCell, /onBlur/);
    assert.match(nameCell, /Enter/);
    assert.doesNotMatch(nameCell, /editor_fill_nombre_infonavit/);
  });

  it("registro patronal y empresa usan el mismo writer auditado", () => {
    assert.match(metadataCell, /editor_update_precal_field/);
    assert.match(metadataCell, /p_field:\s*field/);
    assert.match(metadataCell, /toUpperCase\(\)/);
    assert.match(page, /field="registro_patronal"/);
    assert.match(page, /field="empresa"/);
    assert.match(page, /Registro patronal/);
    assert.match(page, /Nombre de la empresa/);
  });

  it("la tabla conserva monto y notas y suma las dos columnas nuevas", () => {
    assert.match(page, /Monto aprobado/);
    assert.match(page, /Notas/);
    assert.match(page, /colSpan=\{11\}/);
    assert.match(page, /min-w-\[1900px\]/);
  });
});
