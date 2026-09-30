import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isPorCapturarNombre } from "./editor-cliente-nombre";

describe("EditorClienteNombreCell montaje", () => {
  const cell = readFileSync(
    join(process.cwd(), "src/components/editor/EditorClienteNombreCell.tsx"),
    "utf8",
  );
  const registroCell = readFileSync(
    join(process.cwd(), "src/components/editor/EditorRegistroPatronalCell.tsx"),
    "utf8",
  );
  const page = readFileSync(
    join(process.cwd(), "src/app/editor/page.tsx"),
    "utf8",
  );

  it("nombre es editable para todas las filas y POR CAPTURAR inicia vacío", () => {
    assert.equal(isPorCapturarNombre("POR CAPTURAR"), true);
    assert.equal(isPorCapturarNombre("MARIA LOPEZ"), false);
    assert.match(cell, /isPorCapturarNombre/);
    assert.match(cell, /value=\{draft\}/);
    assert.match(cell, /placeholder="Nombre completo"/);
    assert.doesNotMatch(cell, /return \(\s*<span className="truncate"/);
  });

  it("al confirmar nombre llama el RPC manual del Editor", () => {
    assert.match(cell, /editor_update_precal_nombre/);
    assert.match(cell, /p_expediente_id:\s*expedienteId/);
    assert.match(cell, /p_nombre_completo:\s*nombre/);
    assert.match(cell, /normalizePersonName\(draft\)/);
    assert.match(cell, /filterPersonNameInput\(e\.target\.value\)/);
    assert.match(cell, /onBlur/);
    assert.match(cell, /Enter/);
  });

  it("registro patronal es editable en todas las filas y guarda por blur/Enter", () => {
    assert.match(registroCell, /editor_update_precal_registro_patronal/);
    assert.match(registroCell, /placeholder="Registro patronal"/);
    assert.match(registroCell, /onBlur/);
    assert.match(registroCell, /Enter/);
  });

  it("editor monta ambas celdas y conserva badge Reingreso", () => {
    assert.match(page, /EditorClienteNombreCell/);
    assert.match(page, /EditorRegistroPatronalCell/);
    assert.match(page, /registro_patronal:\s*registro/);
    assert.match(page, /Reingreso · revalidar monto/);
    assert.doesNotMatch(cell, /<td[\s>]/);
    assert.doesNotMatch(registroCell, /<td[\s>]/);
  });
});
