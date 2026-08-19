import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("MesaAsesorCambiosPanel P194", () => {
  it("monta recovered changes y badge historial", () => {
    const src = readFileSync(
      resolve(process.cwd(), "src/components/mesa-control/MesaAsesorCambiosPanel.tsx"),
      "utf8",
    );
    assert.match(src, /recoveredChanges/);
    assert.match(src, /MESA_ASESOR_CAMBIOS_HISTORY_EXACT_BADGE/);
    assert.match(src, /hasMesaAsesorCambiosPanelContent/);
    assert.doesNotMatch(src, /valor_anterior.*summary/i);
  });
});
