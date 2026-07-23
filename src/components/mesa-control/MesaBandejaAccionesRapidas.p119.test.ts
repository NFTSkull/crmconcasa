import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

const ROOT = path.join(process.cwd());

describe("MesaBandejaAccionesRapidas UI wiring P119", () => {
  it("acciones usan stopPropagation y RPCs canónicas", () => {
    const ui = readFileSync(
      path.join(ROOT, "src/components/mesa-control/MesaBandejaAccionesRapidas.tsx"),
      "utf8",
    );
    assert.match(ui, /stopPropagation/);
    assert.match(ui, /Siguiente etapa/);
    assert.match(ui, /Tomar expediente/);
    assert.match(ui, /Quitar marca/);

    const page = readFileSync(
      path.join(ROOT, "src/app/mesa-control/page.tsx"),
      "utf8",
    );
    assert.match(page, /avanzarEtapaOperativa/);
    assert.match(page, /mesa_take_expediente|takeExpediente/);
    assert.match(page, /mesa_set_expediente_marcador|setMarcador/);
    assert.match(page, /MesaBandejaAccionesRapidas/);
    assert.match(page, /MesaTieneDatosBadge/);
  });
});
