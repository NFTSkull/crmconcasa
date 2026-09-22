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
  const page = readFileSync(
    join(process.cwd(), "src/app/editor/page.tsx"),
    "utf8",
  );

  it('POR CAPTURAR muestra input editable; nombre normal texto plano', () => {
    assert.equal(isPorCapturarNombre("POR CAPTURAR"), true);
    assert.equal(isPorCapturarNombre("  POR CAPTURAR  "), true);
    assert.equal(isPorCapturarNombre("MARIA LOPEZ"), false);
    assert.equal(isPorCapturarNombre(""), false);
    assert.match(cell, /isPorCapturarNombre/);
    assert.match(cell, /<input/);
    assert.match(cell, /placeholder="Nombre completo"/);
    assert.match(cell, /clienteNombre \|\| "—"/);
  });

  it("al confirmar (blur/Enter) llama editor_fill_nombre_infonavit con args correctos", () => {
    assert.match(cell, /editor_fill_nombre_infonavit/);
    assert.match(cell, /p_expediente_id:\s*expedienteId/);
    assert.match(cell, /p_nombre_completo:\s*nombre/);
    assert.match(cell, /normalizePersonName\(draft\)/);
    assert.match(cell, /filterPersonNameInput\(e\.target\.value\)/);
    assert.match(cell, /onBlur/);
    assert.match(cell, /Enter/);
    assert.doesNotMatch(cell, /auto_fill_nombre_infonavit/);
  });

  it("editor lista monta la celda (sin <td> interno) y conserva badge Reingreso", () => {
    assert.match(page, /EditorClienteNombreCell/);
    assert.match(page, /onApplied=\{/);
    assert.match(page, /cliente_nombre:\s*nombre/);
    assert.match(page, /Reingreso · revalidar monto/);
    assert.doesNotMatch(cell, /<td[\s>]/);
  });
});
