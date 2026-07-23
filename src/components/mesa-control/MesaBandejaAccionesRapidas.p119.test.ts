import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

const ROOT = path.join(process.cwd());

describe("MesaBandejaAccionesRapidas UI wiring P119.3/P119.4", () => {
  it("acciones usan stopPropagation, labels y RPCs canónicas", () => {
    const ui = readFileSync(
      path.join(ROOT, "src/components/mesa-control/MesaBandejaAccionesRapidas.tsx"),
      "utf8",
    );
    assert.match(ui, /stopPropagation/);
    assert.match(ui, /navegar_biometricos|Agendar biométricos/);
    assert.match(ui, /navegar_firma|Agendar firma/);
    assert.match(ui, /etapa_final|Etapa final/);
    assert.match(ui, /MESA_AVANZAR_11_12_CONFIRM|Pago a ConCasa/);
    assert.match(ui, /Tomar expediente/);
    assert.match(ui, /Quitar marca/);
    assert.match(ui, /usesAvanzarRpc/);
    assert.doesNotMatch(ui, /avanzarEtapaOperativa\(.*3/);

    const page = readFileSync(
      path.join(ROOT, "src/app/mesa-control/page.tsx"),
      "utf8",
    );
    assert.match(page, /avanzarEtapaOperativa/);
    assert.match(page, /mesa_take_expediente|takeExpediente/);
    assert.match(page, /mesa_set_expediente_marcador|setMarcador/);
    assert.match(page, /MesaBandejaAccionesRapidas/);

    const lib = readFileSync(
      path.join(ROOT, "src/lib/mesaBandejaAccionesRapidas.ts"),
      "utf8",
    );
    assert.match(lib, /MESA_TIENE_RPC_CANONICA_11_A_12 = true/);
    assert.match(lib, /Pasar a Pago a ConCasa/);
    assert.match(lib, /navegar_biometricos/);
    assert.match(lib, /Falta cargar el Acuse/);
    assert.doesNotMatch(lib, /8:\s*9/);

    const detalle = readFileSync(
      path.join(ROOT, "src/components/mesa-control/MesaExpedienteDetalleReadOnly.tsx"),
      "utf8",
    );
    assert.match(detalle, /MESA_PAGO_CONCASA_ETAPA11_OPERATIVA_COPY/);
    assert.match(detalle, /handleAvanzarOperativo11a12/);
    assert.match(detalle, /deriveAvanceOperativo11a12View/);
  });
});
